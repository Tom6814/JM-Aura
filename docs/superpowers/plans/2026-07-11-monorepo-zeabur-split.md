# Monorepo 拆分与 Zeabur 自动识别 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前仓库重构为清晰的 monorepo，明确拆出 `web/`、`api/` 和共享代码目录，补齐 `zeabur.yaml` 与 workspace 配置，同时把所有相关路径引用、脚本、文档和部署配置同步迁移到新结构。

**Architecture:** 这次重构以“结构搬迁优先、运行时逻辑尽量不动”为原则：`app/` 迁到 `web/`，`src/server/` 迁到 `api/`，`src/shared/` 迁到 `packages/shared/`，然后通过 npm workspaces、根级 `tsconfig.base.json`、子项目 `package.json` 和 `zeabur.yaml` 串起来。所有代码引用、构建配置、README、Dockerfile、测试命令中的路径都会同步更新，避免出现“目录已经拆了，但引用还指向旧路径”的半迁移状态。

**Tech Stack:** Remix, React, TypeScript, Hono, npm workspaces, Zeabur, node:test, CSS

---

## File structure

- Create: `web/`
  - 新前端子项目根目录。
- Create: `web/package.json`
  - 前端 dev/build/start 脚本与依赖入口。
- Create: `web/tsconfig.json`
  - 前端 TS 配置。
- Move: `app/` -> `web/app/`
  - Remix 页面与组件整体迁移。
- Move: `remix.config.js` -> `web/remix.config.js`
  - 前端 Remix 配置迁移。
- Move: `app/**` 对应测试 -> `web/app/**`
  - 所有前端测试文件跟随目录迁移。
- Create: `api/`
  - 新后端子项目根目录。
- Create: `api/package.json`
  - 后端 dev/build/start 脚本与依赖入口。
- Create: `api/tsconfig.json`
  - 后端 TS 配置。
- Move: `src/server/` -> `api/src/server/`
  - Hono API、任务、session、导出逻辑整体迁移。
- Move: `src/server/**` 对应测试 -> `api/src/server/**`
  - 后端测试文件跟随后端目录。
- Create: `packages/shared/`
  - 共享代码工作区。
- Create: `packages/shared/package.json`
  - 共享包 workspace 定义。
- Create: `packages/shared/tsconfig.json`
  - 共享包 TS 配置。
- Move: `src/shared/` -> `packages/shared/src/`
  - 共享 schema、类型、工具迁移。
- Create: `package.json`
  - 根级 workspace 配置和统一脚本（覆盖更新现有文件）。
- Create: `tsconfig.base.json`
  - 根级 TypeScript 基础配置。
- Modify: `tsconfig.json`
  - 变为 workspace 入口或引用根级 base。
- Create: `zeabur.yaml`
  - 显式声明 `web` 与 `api` 服务。
- Move: `Dockerfile.web` -> `web/Dockerfile`
  - 前端服务 Dockerfile。
- Move: `Dockerfile.api` -> `api/Dockerfile`
  - 后端服务 Dockerfile。
- Modify: `.dockerignore`
  - 按 monorepo 新结构更新上下文过滤。
- Modify: `.env.example`
  - 改成 workspace 结构说明。
- Modify: `README.md`
  - 同步 monorepo 路径、Zeabur 配置、`v3.0.0` 说明。
- Modify: `docs/deployment/zeabur.md`
  - 同步到 `web/` / `api/` / `zeabur.yaml` 路径。
- Modify: `README.test.ts`
  - 检查 README 是否已写入新结构与路径。
- Modify: `cli/` 下引用共享代码或后端工具的文件
  - 修复 `../../../src/shared/schema`、`../../src/server/...` 等相对路径。

## Special rule: path references

本次计划的硬性要求是：**任何目录搬迁，都必须在同一任务内同步修复所有路径引用**。  
包括但不限于：

- TS/JS import 路径
- 测试文件路径
- `package.json` 脚本
- `Dockerfile` 内 `COPY` 路径
- README 与部署文档里的路径
- `.env.example`、`zeabur.yaml` 里的工作目录或文件名

如果目录已经迁走，但引用仍残留旧路径，视为该任务未完成。

### Task 1: 建立 monorepo 骨架与根级 workspace 配置

**Files:**
- Modify: `package.json`
- Create: `tsconfig.base.json`
- Modify: `tsconfig.json`
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`

- [ ] **Step 1: 写失败测试，锁定根级 workspace 和子项目脚本存在**

```ts
test("root package uses npm workspaces for web api and shared", async () => {
  const rootPkg = JSON.parse(await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"));

  assert.deepEqual(rootPkg.workspaces, ["web", "api", "packages/*"]);
  assert.equal(rootPkg.private, true);
  assert.equal(rootPkg.scripts["dev:web"], "npm --workspace web run dev");
  assert.equal(rootPkg.scripts["dev:api"], "npm --workspace api run dev");
});
```

```ts
test("workspace package manifests exist", async () => {
  for (const path of ["web/package.json", "api/package.json", "packages/shared/package.json"]) {
    const absolute = new URL(`../../${path}`, import.meta.url);
    const content = await fs.readFile(absolute, "utf8");
    assert.match(content, /"name":/);
  }
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test workspace-layout.test.ts`  
Expected: FAIL，当前还没有 `web/`、`api/`、`packages/shared/` 子项目清单。

- [ ] **Step 3: 重写根级 `package.json` 为 workspace 入口**

```json
{
  "name": "jm-aura-remix",
  "version": "3.0.0",
  "private": true,
  "workspaces": ["web", "api", "packages/*"],
  "scripts": {
    "dev:web": "npm --workspace web run dev",
    "dev:api": "npm --workspace api run dev",
    "build:web": "npm --workspace web run build",
    "build:api": "npm --workspace api run build",
    "typecheck": "npm run typecheck --workspaces",
    "test": "npm run test --workspaces"
  }
}
```

- [ ] **Step 4: 新建根级 `tsconfig.base.json` 和 workspace tsconfig**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": "."
  },
  "include": ["app"]
}
```

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": "."
  },
  "include": ["src"]
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: 新建子项目 `package.json`**

```json
{
  "name": "@jm-aura/web",
  "private": true,
  "scripts": {
    "dev": "remix dev",
    "build": "remix build",
    "start": "remix-serve build/index.js",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test"
  }
}
```

```json
{
  "name": "@jm-aura/api",
  "private": true,
  "scripts": {
    "dev": "tsx src/server/dev.ts",
    "build": "tsc --noEmit",
    "start": "tsx src/server/dev.ts",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test"
  }
}
```

```json
{
  "name": "@jm-aura/shared",
  "private": true,
  "type": "module",
  "main": "./src/index.ts"
}
```

- [ ] **Step 6: 重新运行 workspace 骨架测试**

Run: `node --import tsx --test workspace-layout.test.ts && npm run -s typecheck`  
Expected: PASS，基础工作区结构存在。

- [ ] **Step 7: 提交 monorepo 骨架**

Run: `git rev-parse --is-inside-work-tree && git add package.json tsconfig.json tsconfig.base.json web api packages && git commit -m "chore: scaffold monorepo workspace layout"`  
Expected: 在 git 仓库中提交成功；否则跳过提交。

### Task 2: 迁移 shared 代码，并修复所有共享路径引用

**Files:**
- Move: `src/shared/` -> `packages/shared/src/`
- Modify: `web/app/routes/*.tsx`
- Modify: `web/app/lib/*.ts`
- Modify: `cli/src/**/*.ts`
- Modify: `api/src/server/**/*.ts`
- Modify: 所有引用 `src/shared` 的测试文件

- [ ] **Step 1: 写失败测试，锁定旧 `src/shared` 路径不再出现**

```ts
test("codebase no longer imports from root src/shared after monorepo split", async () => {
  const files = await glob("**/*.{ts,tsx,js,jsx,md}");
  const offenders: string[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    if (content.includes("src/shared/") || content.includes("../../src/shared")) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test shared-paths.test.ts`  
Expected: FAIL，当前大量文件仍引用 `src/shared/schema`。

- [ ] **Step 3: 移动 shared 目录并建立统一导出**

```ts
// packages/shared/src/index.ts
export * from "./schema";
```

并将：

```text
src/shared/schema.ts
```

移动为：

```text
packages/shared/src/schema.ts
```

- [ ] **Step 4: 批量修复代码引用**

把例如：

```ts
import type { FavoritesResult, Profile } from "../../src/shared/schema";
```

改为：

```ts
import type { FavoritesResult, Profile } from "@jm-aura/shared/schema";
```

或在无 package exports 情况下先使用：

```ts
import type { FavoritesResult, Profile } from "../../../packages/shared/src/schema";
```

要求：

- `web`、`api`、`cli`、测试文件全部同步改完
- 不允许保留旧 `src/shared` 路径

- [ ] **Step 5: 重新运行 shared 路径测试与类型检查**

Run: `node --import tsx --test shared-paths.test.ts && npm run -s typecheck`  
Expected: PASS

- [ ] **Step 6: 提交 shared 迁移**

Run: `git rev-parse --is-inside-work-tree && git add packages/shared web api cli shared-paths.test.ts && git commit -m "refactor: move shared schema into workspace package"`  
Expected: 同 Task 1 的提交规则。

### Task 3: 迁移 web 项目并修复所有前端路径引用

**Files:**
- Move: `app/` -> `web/app/`
- Move: `remix.config.js` -> `web/remix.config.js`
- Modify: `web/package.json`
- Modify: `web/tsconfig.json`
- Modify: 前端测试路径与命令
- Modify: 前端源码里所有相对路径 import

- [ ] **Step 1: 写失败测试，锁定前端代码已经指向 `web/app`**

```ts
test("remix app directory is web/app after split", async () => {
  const remixConfig = await fs.readFile(new URL("../../web/remix.config.js", import.meta.url), "utf8");
  assert.match(remixConfig, /appDirectory:\s*"app"/);
});

test("root app directory no longer exists", async () => {
  await assert.rejects(() => fs.stat(new URL("../../app", import.meta.url)));
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test web-layout.test.ts`  
Expected: FAIL，当前 `app/` 仍在根目录。

- [ ] **Step 3: 移动目录并修正前端配置**

将：

```text
app/
remix.config.js
```

迁移为：

```text
web/app/
web/remix.config.js
```

并把：

```js
module.exports = {
  appDirectory: "app",
  ignoredRouteFiles: ["**/.*"],
};
```

保留在 `web/remix.config.js` 中。

- [ ] **Step 4: 修复前端代码引用和测试命令路径**

例如把：

```ts
node --import tsx --test app/components/chrome.test.tsx
```

改为：

```ts
node --import tsx --test web/app/components/chrome.test.tsx
```

并修复源码里依赖 shared、server 或本地模块的相对路径。

- [ ] **Step 5: 重新运行前端关键回归**

Run: `node --import tsx --test web/app/components/chrome.test.tsx web/app/components/home.test.tsx web/app/components/task-queue.test.tsx web/app/routes/me.tasks.test.ts && npm --workspace web run typecheck`  
Expected: PASS，近期搜索、桌面顶栏、下载任务相关前端能力不回退。

- [ ] **Step 6: 提交 web 迁移**

Run: `git rev-parse --is-inside-work-tree && git add web && git commit -m "refactor: move remix app into web workspace"`  
Expected: 同 Task 1 的提交规则。

### Task 4: 迁移 api 项目并修复所有后端路径引用

**Files:**
- Move: `src/server/` -> `api/src/server/`
- Modify: `api/package.json`
- Modify: `api/tsconfig.json`
- Modify: 后端测试路径与脚本
- Modify: 后端源码里所有 import、文件路径与文档路径

- [ ] **Step 1: 写失败测试，锁定后端代码已经指向 `api/src/server`**

```ts
test("api server directory exists after split", async () => {
  const stat = await fs.stat(new URL("../../api/src/server", import.meta.url));
  assert.equal(stat.isDirectory(), true);
});

test("root src/server no longer exists", async () => {
  await assert.rejects(() => fs.stat(new URL("../../src/server", import.meta.url)));
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test api-layout.test.ts`  
Expected: FAIL，当前后端仍在 `src/server/`。

- [ ] **Step 3: 移动后端目录并修复脚本**

将：

```text
src/server/
```

迁移为：

```text
api/src/server/
```

并把 `api/package.json` 脚本固定为：

```json
{
  "scripts": {
    "dev": "tsx src/server/dev.ts",
    "build": "tsc --noEmit",
    "start": "tsx src/server/dev.ts"
  }
}
```

- [ ] **Step 4: 修复所有后端与 CLI 路径引用**

例如把：

```ts
import { Semaphore } from "../../src/server/task/semaphore";
```

改为：

```ts
import { Semaphore } from "../../api/src/server/task/semaphore";
```

或更进一步通过共享包/后端内部 alias 统一。

要求：

- API 代码
- CLI 代码
- 测试代码
- 文档里的路径说明

全部同步更新。

- [ ] **Step 5: 重新运行后端关键回归**

Run: `node --import tsx --test api/src/server/routes/tasks.test.ts api/src/server/task/taskManager.test.ts api/src/server/session.test.ts && npm --workspace api run typecheck`  
Expected: PASS，下载任务、session 隔离、删除和自动清理不回退。

- [ ] **Step 6: 提交 api 迁移**

Run: `git rev-parse --is-inside-work-tree && git add api cli && git commit -m "refactor: move hono server into api workspace"`  
Expected: 同 Task 1 的提交规则。

### Task 5: 补齐 Zeabur 配置、Dockerfile、新路径文档与 README

**Files:**
- Create: `zeabur.yaml`
- Move: `Dockerfile.web` -> `web/Dockerfile`
- Move: `Dockerfile.api` -> `api/Dockerfile`
- Modify: `.dockerignore`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/deployment/zeabur.md`
- Modify: `README.test.ts`

- [ ] **Step 1: 写失败测试，锁定 README 和部署文件已更新新路径**

```ts
test("README documents monorepo web api structure", async () => {
  const content = await fs.readFile(new URL("../../README.md", import.meta.url), "utf8");
  assert.match(content, /web\//);
  assert.match(content, /api\//);
  assert.match(content, /packages\/shared/);
  assert.match(content, /zeabur\.yaml/);
});
```

```ts
test("zeabur config declares web and api services", async () => {
  const content = await fs.readFile(new URL("../../zeabur.yaml", import.meta.url), "utf8");
  assert.match(content, /web:/);
  assert.match(content, /api:/);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test README.test.ts zeabur-config.test.ts`  
Expected: FAIL，当前尚未迁到 monorepo 路径。

- [ ] **Step 3: 创建 `zeabur.yaml` 和子项目 Dockerfile**

```yaml
services:
  web:
    root: ./web
    dockerfile: Dockerfile
  api:
    root: ./api
    dockerfile: Dockerfile
```

```dockerfile
# web/Dockerfile
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package*.json ./
COPY web/package.json ./web/package.json
COPY api/package.json ./api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm --workspace web run build

FROM node:20-alpine
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/web ./web
ENV PORT=3000
CMD ["npm", "--workspace", "web", "run", "start"]
```

```dockerfile
# api/Dockerfile
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package*.json ./
COPY web/package.json ./web/package.json
COPY api/package.json ./api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm --workspace api run build

FROM node:20-alpine
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/api ./api
ENV PORT=8787
CMD ["npm", "--workspace", "api", "run", "start"]
```

- [ ] **Step 4: 同步更新 `.dockerignore`、`.env.example`、README、部署文档中的全部路径**

要求至少替换这些旧引用：

- `Dockerfile.web` -> `web/Dockerfile`
- `Dockerfile.api` -> `api/Dockerfile`
- `app/` -> `web/app/`
- `src/server/` -> `api/src/server/`
- `src/shared/` -> `packages/shared/src/`

README 中必须包含：

- `v3.0.0`
- `JM-Aura/` 对比
- monorepo 结构图
- 本地开发命令
- Zeabur 双服务部署方式

- [ ] **Step 5: 跑全量类型检查和关键回归**

Run: `npm run -s typecheck && npm run -s build:web && npm run -s build:api && node --import tsx --test README.test.ts`  
Expected: PASS

- [ ] **Step 6: 手动检查路径残留**

Run: `rg "src/shared|src/server|Dockerfile\\.web|Dockerfile\\.api|app/" README.md docs web api cli package.json`  
Expected: 只允许新结构里的合法引用，不允许保留旧路径说明。

- [ ] **Step 7: 提交部署与文档更新**

Run: `git rev-parse --is-inside-work-tree && git add zeabur.yaml web/Dockerfile api/Dockerfile .dockerignore .env.example README.md docs/deployment/zeabur.md README.test.ts && git commit -m "chore: align monorepo docs and zeabur config"`  
Expected: 同 Task 1 的提交规则。

## Self-review

- **Spec coverage:** 已覆盖 monorepo 骨架、shared 迁移、web 迁移、api 迁移、Zeabur 配置、README 与文档更新。
- **Placeholder scan:** 没有留下 TBD/TODO；“路径引用同步迁移”被单独写成硬规则与任务，不是口头要求。
- **Type consistency:** 统一使用 `web/`、`api/`、`packages/shared/`、`zeabur.yaml`、`web/Dockerfile`、`api/Dockerfile` 这些新路径名称，避免新旧命名混杂。
