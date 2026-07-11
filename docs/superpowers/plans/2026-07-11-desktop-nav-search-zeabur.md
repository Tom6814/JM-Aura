# 桌面顶栏、搜索修复与 Zeabur 部署整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复首页和桌面顶栏搜索提交不刷新的问题，重构桌面顶栏为更适合大屏的导航结构，补齐 Zeabur 前后端双服务部署配置，整理仓库根目录并重写双语 `README` 作为 `v3.0.0` 发布与使用文档。

**Architecture:** 搜索继续以 Remix `GET` 表单和 URL 查询参数为单一事实来源，避免手写客户端跳转；桌面顶栏只改 `AppChrome` 和相关样式，手机端完全不动。部署层通过环境变量解耦前端与 API 服务地址，仓库层通过归档/移走历史目录和完善 `README`、`.gitignore`、部署文件，让根目录变成可直接发布 GitHub 和部署 Zeabur 的主项目结构。

**Tech Stack:** Remix, React, TypeScript, Hono, Node.js, CSS, Zeabur deployment config

---

## File structure

- Modify: `app/components/chrome.tsx`
  - 修复桌面搜索提交，重构桌面顶栏为三段式导航与头像菜单。
- Modify: `app/components/home.tsx`
  - 统一首页搜索提交行为，确保跳到 `/search?q=...`。
- Modify: `app/components/site-layout.tsx`
  - 如有必要，补桌面壳层结构支持，但只在确实需要时改。
- Modify: `app/components/site-layout.test.tsx`
  - 桌面顶栏结构不回退。
- Modify: `app/components/home.test.tsx`
  - 首页搜索提交行为测试。
- Modify: `app/routes/search.tsx`
  - 统一搜索参数读取与输入 name，避免 URL 变化不触发结果刷新。
- Modify: `app/styles/shell.css`
  - 桌面顶栏排版、头像菜单、桌面搜索栏样式。
- Modify: `app/styles/app.css`
  - 如需补全桌面导航细节样式。
- Modify: `app/entry.server.test.tsx` 或现有根壳测试文件
  - 确认顶栏 SSR 结构与手机端不回退。
- Modify: `app/lib/jm-rpc.server.ts`
  - 统一部署环境下 API origin 解析逻辑，如需补前端/服务端双服务配置入口。
- Modify: `package.json`
  - 增加 Zeabur 友好的构建/启动脚本。
- Create: `Dockerfile.web`
  - 前端服务构建与启动。
- Create: `Dockerfile.api`
  - 后端服务构建与启动。
- Create: `.env.example`
  - 前后端所需环境变量样例。
- Modify: `.gitignore`
  - 忽略运行产物、导出目录、归档目录、部署缓存。
- Create: `README.md`
  - 双语 `v3.0.0` README。
- Create: `docs/deployment/zeabur.md`
  - Zeabur 双服务部署说明细节。
- Create: `archive/`
  - 用于收纳旧项目与历史产物。
- Move: `JM-Aura/` -> `archive/JM-Aura/`
- Move: `JMComic-Crawler-Python-master/` -> `archive/JMComic-Crawler-Python-master/`
- Move: `.superpowers/` -> `archive/.superpowers/`
- Move: `.trae-html-share-packages/` -> `archive/.trae-html-share-packages/`
- Move: `ai-agent-handoff-2026-07-09/` -> `archive/ai-agent-handoff-2026-07-09/`

### Task 1: 修复首页与桌面顶栏搜索提交刷新

**Files:**
- Modify: `app/components/chrome.tsx`
- Modify: `app/components/home.tsx`
- Modify: `app/routes/search.tsx`
- Modify: `app/components/home.test.tsx`
- Modify: `app/components/site-layout.test.tsx`

- [ ] **Step 1: 写失败测试，锁定首页与顶栏搜索都用 `q` 参数跳转**

```tsx
test("AppChrome desktop search submits to /search with q parameter", () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/discover"]}>
      <AppChrome>
        <div>content</div>
      </AppChrome>
    </MemoryRouter>,
  );

  assert.match(markup, /action="\/search"/);
  assert.match(markup, /name="q"/);
});
```

```tsx
test("home quick search submits using GET q parameter", () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <QuickSearchInline />
    </MemoryRouter>,
  );

  assert.match(markup, /action="\/search"/);
  assert.match(markup, /name="q"/);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test app/components/home.test.tsx app/components/site-layout.test.tsx`  
Expected: FAIL，当前桌面顶栏和首页搜索使用 `keyword`，与计划中的 `q` 不匹配。

- [ ] **Step 3: 统一桌面顶栏搜索表单**

```tsx
const searchSlot =
  props.showSearch === false
    ? null
    : props.primarySlot ?? (
        <Form action="/search" className="app-topbar__search" method="get" role="search">
          <div className="md-search-bar md-search-bar--compact">
            <span className="material-symbols-rounded" aria-hidden="true">
              search
            </span>
            <input
              className="md-search-bar__input"
              name="q"
              type="search"
              defaultValue={getSearchValueFromLocation(location)}
              placeholder="搜索作品、作者、车号…"
            />
          </div>
        </Form>
      );
```

- [ ] **Step 4: 统一首页快速搜索表单**

```tsx
export function QuickSearchInline() {
  return (
    <Form method="get" action="/search" className="home-quick-search" role="search">
      <div className="md-search-bar">
        <span className="material-symbols-rounded" aria-hidden="true">
          search
        </span>
        <input
          className="md-search-bar__input"
          type="search"
          name="q"
          placeholder="搜索标题、作者、标签或 JM 号…"
          aria-label="搜索标题、作者、标签或 JM 号"
        />
      </div>
      <button className="md-button md-button--primary" type="submit">
        搜索
      </button>
    </Form>
  );
}
```

- [ ] **Step 5: 让搜索页兼容 `q` 并回退支持旧参数**

```ts
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.searchParams);
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length > 0 && !searchParams.has("keyword")) {
    searchParams.set("keyword", q);
  }

  const { keyword, page, main_tag, order_by, time } = parseSearchParams(searchParams);
  const apiOrigin = getApiOrigin(request);
  ...
}
```

```tsx
<input
  className="md-search-bar__input"
  type="search"
  name="q"
  defaultValue={props.data.keyword}
  placeholder="搜索标题、作者、标签或 ID…"
  aria-label="搜索标题、作者、标签或 ID"
/>
```

- [ ] **Step 6: 重新运行测试，确认搜索提交流程通过**

Run: `node --import tsx --test app/components/home.test.tsx app/components/site-layout.test.tsx 'app/routes/search.tsx'`  
Expected: 相关搜索测试 PASS；如果 `search.tsx` 没有单测入口，改跑 `npm run -s typecheck` 并补静态校验。

- [ ] **Step 7: 提交搜索修复**

Run: `git rev-parse --is-inside-work-tree && git add app/components/chrome.tsx app/components/home.tsx app/routes/search.tsx app/components/home.test.tsx app/components/site-layout.test.tsx && git commit -m "fix: align desktop and home search submission"`  
Expected: 在 git 仓库里成功提交；若当前目录不是 git 仓库则跳过提交。

### Task 2: 重构桌面顶栏为三段式导航与头像菜单

**Files:**
- Modify: `app/components/chrome.tsx`
- Modify: `app/styles/shell.css`
- Modify: `app/styles/app.css`
- Modify: `app/components/site-layout.test.tsx`
- Modify: `app/entry.server.test.tsx`

- [ ] **Step 1: 写失败测试，锁定桌面导航和头像菜单项**

```tsx
test("desktop chrome renders primary nav and avatar menu entries", () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/search"]}>
      <AppChrome>
        <div>content</div>
      </AppChrome>
    </MemoryRouter>,
  );

  assert.match(markup, /首页/);
  assert.match(markup, /搜索/);
  assert.match(markup, /发现/);
  assert.match(markup, /设置/);
  assert.match(markup, /下载/);
  assert.match(markup, /收藏/);
  assert.doesNotMatch(markup, /我的<\/span>/);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test app/components/site-layout.test.tsx app/entry.server.test.tsx`  
Expected: FAIL，当前桌面顶栏没有头像菜单，且一级导航仍包含“我的”。

- [ ] **Step 3: 为桌面端添加三段式结构和头像菜单状态**

```tsx
const desktopNavItems = [
  { to: "/", label: "首页", active: pathname === "/" },
  { to: "/search", label: "搜索", active: pathname.startsWith("/search") },
  { to: "/discover", label: "发现", active: pathname.startsWith("/discover") },
];

const profileMenuItems = [
  { to: "/me", label: "设置" },
  { to: "/me/tasks", label: "下载" },
  { to: "/me/favorites", label: "收藏" },
];
```

```tsx
const [profileMenuOpen, setProfileMenuOpen] = useState(false);

<div className="app-topbar__desktop-nav" aria-label="桌面主导航">
  {desktopNavItems.map((item) => (
    <Link
      key={item.to}
      className={`app-desktop-nav-link${item.active ? " app-desktop-nav-link--active" : ""}`}
      to={item.to}
      prefetch="intent"
    >
      {item.label}
    </Link>
  ))}
</div>

<div className="app-topbar__profile-menu">
  <button
    type="button"
    className="app-avatar-button"
    aria-expanded={profileMenuOpen}
    aria-haspopup="menu"
    onClick={() => setProfileMenuOpen((value) => !value)}
  >
    <span className="material-symbols-rounded" aria-hidden="true">
      account_circle
    </span>
    <span className="sr-only">打开个人菜单</span>
  </button>
  {profileMenuOpen ? (
    <div className="app-avatar-menu" role="menu">
      {profileMenuItems.map((item) => (
        <Link key={item.to} className="app-avatar-menu__item" role="menuitem" to={item.to}>
          {item.label}
        </Link>
      ))}
    </div>
  ) : null}
</div>
```

- [ ] **Step 4: 为桌面顶栏补高性能样式**

```css
.app-topbar__row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 20px;
}

.app-topbar__desktop-nav {
  display: none;
}

.app-avatar-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  display: grid;
  min-width: 180px;
  padding: 10px;
  border-radius: 18px;
  background: var(--md-sys-color-surface-container);
  box-shadow: var(--md-sys-elevation-level2);
}

@media (min-width: 960px) {
  .app-topbar__desktop-nav {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .app-bottom-nav--mobile {
    display: none;
  }
}
```

- [ ] **Step 5: 确认手机端结构不回退**

Run: `node --import tsx --test app/components/site-layout.test.tsx app/entry.server.test.tsx`  
Expected: PASS，桌面新结构存在，手机底栏相关断言仍通过。

- [ ] **Step 6: 提交桌面顶栏重构**

Run: `git rev-parse --is-inside-work-tree && git add app/components/chrome.tsx app/styles/shell.css app/styles/app.css app/components/site-layout.test.tsx app/entry.server.test.tsx && git commit -m "feat: redesign desktop top navigation"`  
Expected: 同 Task 1 的提交规则。

### Task 3: 补齐 Zeabur 双服务部署配置

**Files:**
- Modify: `package.json`
- Modify: `app/lib/jm-rpc.server.ts`
- Create: `Dockerfile.web`
- Create: `Dockerfile.api`
- Create: `.env.example`
- Create: `docs/deployment/zeabur.md`

- [ ] **Step 1: 写失败测试，锁定部署环境下 API origin 可配置**

```ts
test("getApiOrigin prefers API_ORIGIN when provided", () => {
  const request = new Request("https://web.example.com/search");
  const original = process.env.API_ORIGIN;
  process.env.API_ORIGIN = "https://api.example.com";

  try {
    assert.equal(getApiOrigin(request), "https://api.example.com");
  } finally {
    process.env.API_ORIGIN = original;
  }
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test app/lib/jm-rpc.server.test.ts --test-name-pattern "API_ORIGIN"`  
Expected: FAIL，当前 `getApiOrigin()` 可能仍以本地或请求推导为主。

- [ ] **Step 3: 统一 API origin 解析逻辑**

```ts
export function getApiOrigin(request: Request): string {
  const fromEnv = process.env.API_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return "http://127.0.0.1:8787";
  }

  return url.origin;
}
```

- [ ] **Step 4: 补齐 `package.json` 的双服务脚本**

```json
{
  "scripts": {
    "dev:web": "remix dev",
    "dev:api": "tsx src/server/dev.ts",
    "build:web": "remix build",
    "build:api": "tsc -p tsconfig.json --outDir build-server",
    "start:web": "remix-serve build/index.js",
    "start:api": "node build-server/src/server/index.js"
  }
}
```

- [ ] **Step 5: 创建 Zeabur 用的两个 Dockerfile**

```dockerfile
# Dockerfile.web
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build:web

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package*.json ./
ENV PORT=3000
CMD ["npm", "run", "start:web"]
```

```dockerfile
# Dockerfile.api
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build:api

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build-server ./build-server
COPY package*.json ./
ENV PORT=8787
CMD ["npm", "run", "start:api"]
```

- [ ] **Step 6: 补 `.env.example` 和 Zeabur 文档**

```env
# web
API_ORIGIN=https://your-api.zeabur.app

# api
PORT=8787
JM_PROXY_URL=
EXPORT_ROOT=.cache/exports
```

```md
# Zeabur 部署

## web service
- Dockerfile: `Dockerfile.web`
- Build: `docker build -f Dockerfile.web .`
- Env: `API_ORIGIN=https://your-api.zeabur.app`

## api service
- Dockerfile: `Dockerfile.api`
- Build: `docker build -f Dockerfile.api .`
- Env: `PORT`, `JM_PROXY_URL`, `EXPORT_ROOT`
```

- [ ] **Step 7: 重新运行测试与类型检查**

Run: `npm run -s typecheck && node --import tsx --test app/lib/jm-rpc.server.test.ts`  
Expected: PASS

- [ ] **Step 8: 提交部署支持**

Run: `git rev-parse --is-inside-work-tree && git add package.json app/lib/jm-rpc.server.ts Dockerfile.web Dockerfile.api .env.example docs/deployment/zeabur.md && git commit -m "chore: add zeabur dual-service deployment config"`  
Expected: 同 Task 1 的提交规则。

### Task 4: 整理仓库结构并重写双语 README

**Files:**
- Modify: `.gitignore`
- Create: `README.md`
- Create: `archive/README.md`
- Move: `JM-Aura/` -> `archive/JM-Aura/`
- Move: `JMComic-Crawler-Python-master/` -> `archive/JMComic-Crawler-Python-master/`
- Move: `.superpowers/` -> `archive/.superpowers/`
- Move: `.trae-html-share-packages/` -> `archive/.trae-html-share-packages/`
- Move: `ai-agent-handoff-2026-07-09/` -> `archive/ai-agent-handoff-2026-07-09/`

- [ ] **Step 1: 写失败检查，锁定 README 包含 v3.0.0 与对比说明**

```ts
test("README includes v3.0.0 and JM-Aura comparison sections", async () => {
  const content = await fs.readFile(new URL("../../README.md", import.meta.url), "utf8");

  assert.match(content, /v3\.0\.0/);
  assert.match(content, /JM-Aura/);
  assert.match(content, /Zeabur/);
  assert.match(content, /Quick Start|快速开始/);
});
```

- [ ] **Step 2: 运行检查，确认当前失败**

Run: `node --import tsx --test README.test.ts`  
Expected: FAIL，如果没有 `README.test.ts`，则创建该测试文件；当前 README 缺少所需结构。

- [ ] **Step 3: 重写双语 README**

```md
# JM-Aura-Remix v3.0.0

> 中文 | English

## 中文

### 项目简介
`JM-Aura-Remix v3.0.0` 是一次全面重构版本，使用 Remix + Hono 重建页面层、任务系统和部署结构。

### 与 JM-Aura 的区别
- `JM-Aura/`：旧版本与历史参考目录
- 当前根目录项目：新的主线版本
- 技术栈从旧结构切换为 Remix Web + Hono API

### 快速开始
```bash
npm ci
npm run dev:api
npm run dev:web
```

### Zeabur 部署
- `web`: `Dockerfile.web`
- `api`: `Dockerfile.api`

## English

### Overview
`JM-Aura-Remix v3.0.0` is a full rebuild based on Remix + Hono.

### What changed from JM-Aura
- `JM-Aura/` remains as the legacy reference
- the root project is now the recommended mainline version
- deployment is split into `web` and `api`
```

- [ ] **Step 4: 补仓库归档说明与 `.gitignore`**

```gitignore
node_modules
build
build-server
.cache
.DS_Store
archive/.superpowers
archive/.trae-html-share-packages
exports
```

```md
# Archive

This directory stores legacy references and local artifacts that are intentionally excluded from the main GitHub-facing project structure.
```

- [ ] **Step 5: 移动旧目录到 `archive/`**

Run:

```bash
mkdir -p archive && \
mv JM-Aura archive/JM-Aura && \
mv JMComic-Crawler-Python-master archive/JMComic-Crawler-Python-master && \
mv .superpowers archive/.superpowers && \
mv .trae-html-share-packages archive/.trae-html-share-packages && \
mv ai-agent-handoff-2026-07-09 archive/ai-agent-handoff-2026-07-09
```

Expected: 根目录只保留主项目相关目录与配置文件。

- [ ] **Step 6: 重新运行类型检查和 README/结构检查**

Run: `npm run -s typecheck && node --import tsx --test README.test.ts`  
Expected: PASS

- [ ] **Step 7: 手动检查根目录**

Run: `ls -la`  
Expected: 根目录不再直接出现 `JM-Aura/`、`JMComic-Crawler-Python-master/`、`.superpowers/`、`.trae-html-share-packages/`、`ai-agent-handoff-2026-07-09/`。

- [ ] **Step 8: 提交仓库整理与 README**

Run: `git rev-parse --is-inside-work-tree && git add README.md .gitignore archive docs/deployment/zeabur.md && git commit -m "docs: rewrite readme and organize repository"`  
Expected: 同 Task 1 的提交规则。

## Self-review

- **Spec coverage:** 已覆盖搜索修复、桌面顶栏、Zeabur 双服务部署、仓库整理以及双语 `README` 重写。
- **Placeholder scan:** 计划中没有 TBD/TODO 或“自行处理”描述，每个任务都给了代码或明确命令。
- **Type consistency:** 统一使用 `q`, `API_ORIGIN`, `Dockerfile.web`, `Dockerfile.api`, `archive/`, `README.md` 这些名字，避免后续步骤对不上。
