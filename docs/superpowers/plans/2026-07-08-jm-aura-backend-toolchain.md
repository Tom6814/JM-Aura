# JM-Aura 后端工具链（任务 + ZIP 导出 + CLI）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Goal:** 在保持后端仅使用 Hono 的前提下，新增“会话隔离 + 异步任务系统 + ZIP 导出（临时落盘 TTL=2h）+ manifest（客户端自打包）+ Node CLI 客户端（Zod 校验 + `--origin`）”，复刻 Python 工具链的核心工作流并保证高性能高可用。
>
> **Architecture:** Hono 提供 REST API；`JmSessionManager` 按 cookie/header 隔离 `JMComicClient` cookieJar；`TaskManager` 管理导出任务并发与取消；`ExportStore` 负责临时文件与 TTL 清理；`ZipExporter` 执行 album/favorites 导出；CLI 通过 HTTP 调用任务接口，轮询进度并下载 ZIP 到本地，可选 manifest + 本地打包。
>
> **Tech Stack:** TypeScript, Hono, Zod, Node.js streams/fs, sharp（仅在需要解密/转码时使用），node:test（测试）。
>
> ---

## 0. 代码结构（将新增/修改的文件）

**新增（后端）：**
- `src/server/session.ts`：`JmSessionManager`（从 request 解析 session，返回对应 `JMComicClient`）
- `src/server/task/types.ts`：任务类型与状态类型（Zod + TS）
- `src/server/task/semaphore.ts`：轻量 `Semaphore`（并发控制）
- `src/server/task/taskManager.ts`：任务创建/运行/取消/查询
- `src/server/export/exportStore.ts`：临时文件路径、TTL、清理
- `src/server/export/zip/zipStoreWriter.ts`：ZIP store 写入器（最小可用版本：先写文件，不做压缩）
- `src/server/export/zip/crc32.ts`：CRC32（用于 ZIP）
- `src/server/export/zipExporter.ts`：album/favorites → zip（调用 jmClient 获取数据与图片）
- `src/server/export/manifest.ts`：album manifest（供客户端自打包）
- `src/server/routes/tasks.ts`：任务路由（挂到主 app）

**修改（后端）：**
- `src/server/index.ts`：引入 session/task/export 路由；把原先单例 `jmClient` 改为 `sessionManager.getClient(c)` 获取
- `src/shared/schema.ts`：补充 task/export manifest 的 schema（如果需要）

**新增（CLI）：**
- `cli/package.json`（独立 node 包，避免影响 web 依赖）
- `cli/tsconfig.json`
- `cli/src/index.ts`：入口，`process.argv` 解析
- `cli/src/http.ts`：`--origin`、session header、fetch wrapper
- `cli/src/schema.ts`：复用 `src/shared/schema.ts` 并定义 CLI 侧需要的 task schema
- `cli/src/commands/login.ts`
- `cli/src/commands/exportAlbum.ts`
- `cli/src/commands/exportFavorites.ts`
- `cli/src/commands/tasks.ts`（可选：list/status）
- `cli/src/storage/sessionStore.ts`：保存 session_id（本地文件）

**测试：**
- 后端：`src/server/session.test.ts`、`src/server/task/taskManager.test.ts`、`src/server/export/zip/zipStoreWriter.test.ts`
- CLI：`cli/src/http.test.ts`（最小 smoke 测试）

---

## Task 1：引入 Session（隔离 cookieJar）

**Files:**
- Create: `src/server/session.ts`
- Modify: `src/server/index.ts`
- Test: `src/server/session.test.ts`

- [ ] **Step 1: 写失败测试（session id 优先级与隔离）**

`src/server/session.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { JmSessionManager } from "./session";

test("session manager prefers x-jm-session header over cookie", () => {
  const sm = new JmSessionManager({ createClient: () => ({ id: crypto.randomUUID() } as any) });
  const req = new Request("http://localhost/", {
    headers: {
      cookie: "jm_session=cookie1",
      "x-jm-session": "header1",
    },
  });

  const ctx = sm.get(req);
  assert.equal(ctx.sessionId, "header1");
});

test("session manager returns same client for same session id", () => {
  let created = 0;
  const sm = new JmSessionManager({
    createClient: () => {
      created += 1;
      return ({ created } as any);
    },
  });

  const req1 = new Request("http://localhost/", { headers: { "x-jm-session": "s1" } });
  const req2 = new Request("http://localhost/", { headers: { "x-jm-session": "s1" } });

  const c1 = sm.get(req1).client;
  const c2 = sm.get(req2).client;
  assert.equal(c1, c2);
  assert.equal(created, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/server/session.test.ts`  
Expected: FAIL（因为 `JmSessionManager` 未实现）

- [ ] **Step 3: 实现最小 `JmSessionManager`**

`src/server/session.ts`（最小实现，先只做内存 map，不做 TTL）：
```ts
import { JMComicClient } from "./jmClient";

export interface SessionContext {
  sessionId: string;
  isNew: boolean;
  client: JMComicClient;
}

export class JmSessionManager {
  private readonly sessions = new Map<string, JMComicClient>();
  private readonly createClientFn: () => JMComicClient;

  constructor(options?: { createClient?: () => JMComicClient }) {
    this.createClientFn = options?.createClient ?? (() => new JMComicClient());
  }

  get(request: Request): SessionContext {
    const headerId = request.headers.get("x-jm-session")?.trim();
    const cookieId = readCookie(request.headers.get("cookie"), "jm_session");
    const sessionId = (headerId && headerId.length > 0 ? headerId : cookieId) ?? crypto.randomUUID();

    const existing = this.sessions.get(sessionId);
    if (existing) {
      return { sessionId, isNew: false, client: existing };
    }

    const client = this.createClientFn();
    this.sessions.set(sessionId, client);
    return { sessionId, isNew: true, client };
  }
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/g);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    const v = part.slice(eq + 1).trim();
    return v.length ? v : null;
  }
  return null;
}
```

- [ ] **Step 4: 再跑测试转绿**

Run: `node --import tsx --test src/server/session.test.ts`  
Expected: PASS

- [ ] **Step 5: 将 `src/server/index.ts` 从单例 jmClient 改为 session client**

修改思路（后续 tasks 继续扩展）：在每个 handler 内用：
```ts
const { client: jmClient, sessionId, isNew } = sessionManager.get(c.req.raw);
```
并在 `isNew` 时给响应 Set-Cookie（对 Web 友好）。

---

## Task 2：任务类型与并发控制（Semaphore）

**Files:**
- Create: `src/server/task/types.ts`
- Create: `src/server/task/semaphore.ts`
- Test: `src/server/task/semaphore.test.ts`

- [ ] **Step 1: 写失败测试（Semaphore 限流）**

`src/server/task/semaphore.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { Semaphore } from "./semaphore";

test("semaphore limits concurrency", async () => {
  const sem = new Semaphore(1);
  const events: string[] = [];

  const a = sem.run(async () => {
    events.push("a:start");
    await new Promise((r) => setTimeout(r, 50));
    events.push("a:end");
  });

  const b = sem.run(async () => {
    events.push("b:start");
    events.push("b:end");
  });

  await Promise.all([a, b]);
  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/server/task/semaphore.test.ts`  
Expected: FAIL（Semaphore 未实现）

- [ ] **Step 3: 实现 `Semaphore`**

`src/server/task/semaphore.ts`：
```ts
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = Math.max(1, Math.floor(concurrency));
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }

    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.available -= 1;
    return () => this.release();
  }

  private release() {
    this.available += 1;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
```

- [ ] **Step 4: 再跑测试转绿**

Run: `node --import tsx --test src/server/task/semaphore.test.ts`  
Expected: PASS

---

## Task 3：TaskManager（创建/运行/取消/查询）

**Files:**
- Create: `src/server/task/types.ts`
- Create: `src/server/task/taskManager.ts`
- Test: `src/server/task/taskManager.test.ts`

- [ ] **Step 1: 写失败测试（状态机与取消）**

`src/server/task/taskManager.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { TaskManager } from "./taskManager";

test("task transitions queued -> running -> succeeded", async () => {
  const tm = new TaskManager({ concurrency: 1 });
  const task = tm.create("export_album_zip", async (ctx) => {
    ctx.setTotal(2);
    ctx.tick("a");
    ctx.tick("b");
    return { filePath: "/tmp/fake.zip", fileName: "fake.zip", size: 123 };
  });

  assert.equal(tm.get(task.id)?.status, "queued");
  await tm.run(task.id);
  assert.equal(tm.get(task.id)?.status, "succeeded");
  assert.equal(tm.get(task.id)?.result?.fileName, "fake.zip");
});

test("cancel marks task canceled", async () => {
  const tm = new TaskManager({ concurrency: 1 });
  const task = tm.create("export_album_zip", async (ctx) => {
    ctx.setTotal(1);
    await new Promise((r) => setTimeout(r, 100));
    ctx.tick("done");
    return { filePath: "/tmp/fake.zip", fileName: "fake.zip", size: 1 };
  });

  const runPromise = tm.run(task.id);
  tm.cancel(task.id);
  await runPromise.catch(() => null);
  assert.equal(tm.get(task.id)?.status, "canceled");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/server/task/taskManager.test.ts`  
Expected: FAIL（TaskManager 未实现）

- [ ] **Step 3: 实现 `TaskManager`（最小可用）**

实现要点：
- 内存 map 存 task
- `create(type, runner)` 生成 task id
- `run(id)` 通过 semaphore 控制并发
- `cancel(id)` 设置 canceled 标记，runner 需要主动检查 `ctx.isCanceled()`

（实现代码写在 `taskManager.ts`，测试驱动逐步补齐）

- [ ] **Step 4: 再跑测试转绿**

Run: `node --import tsx --test src/server/task/taskManager.test.ts`  
Expected: PASS

---

## Task 4：ExportStore（临时落盘 + TTL=2h）

**Files:**
- Create: `src/server/export/exportStore.ts`
- Test: `src/server/export/exportStore.test.ts`

- [ ] **Step 1: 写失败测试（过期判断与路径）**

`src/server/export/exportStore.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ExportStore } from "./exportStore";

test("export store builds deterministic path", () => {
  const store = new ExportStore({ rootDir: ".cache/exports", ttlMs: 2 * 60 * 60 * 1000 });
  assert.match(store.getZipPath("t1"), /\\.cache\\/exports\\/t1\\.zip$/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/server/export/exportStore.test.ts`  
Expected: FAIL（ExportStore 未实现）

- [ ] **Step 3: 实现 `ExportStore`**

实现要点：
- 构建目录（用 `fs.mkdir({ recursive:true })`）
- `getZipPath(taskId)` / `getZipName(taskId, hint?)`
- `isExpired(mtimeMs)` / `cleanupOnce()`（扫描并删除过期）

- [ ] **Step 4: 再跑测试转绿**

Run: `node --import tsx --test src/server/export/exportStore.test.ts`  
Expected: PASS

---

## Task 5：ZIP store writer（最小可用）

> 目标：先做到“能正确生成 zip（store，不压缩）”，再逐步优化流式/CRC/descriptor。

**Files:**
- Create: `src/server/export/zip/crc32.ts`
- Create: `src/server/export/zip/zipStoreWriter.ts`
- Test: `src/server/export/zip/zipStoreWriter.test.ts`

- [ ] **Step 1: 写失败测试（写入 2 个文件的 zip，能被 unzip 识别）**

`src/server/export/zip/zipStoreWriter.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZipStoreWriter } from "./zipStoreWriter";

test("zip writer produces a readable zip file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jm-zip-"));
  const zipPath = path.join(dir, "out.zip");
  const writer = await ZipStoreWriter.open(zipPath);
  await writer.addFile("a.txt", Buffer.from("hello"));
  await writer.addFile("b/b.txt", Buffer.from("world"));
  await writer.close();

  const stat = await fs.stat(zipPath);
  assert.ok(stat.size > 50);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/server/export/zip/zipStoreWriter.test.ts`  
Expected: FAIL（ZipStoreWriter 未实现）

- [ ] **Step 3: 实现最小 ZipStoreWriter**

说明：
- 第一版允许“已知完整 buffer”的 `addFile(name, bytes)`（先不做 stream）
- 生成标准 zip（local file header + central directory + end record）
- 使用 store（compression=0）
- CRC32 可先用最小实现（`crc32.ts`）

- [ ] **Step 4: 再跑测试转绿**

Run: `node --import tsx --test src/server/export/zip/zipStoreWriter.test.ts`  
Expected: PASS

---

## Task 6：ZipExporter(export_album_zip)

**Files:**
- Create: `src/server/export/zipExporter.ts`
- Modify: `src/shared/schema.ts`（如需要新增 task result schema）
- Test: `src/server/export/zipExporter.test.ts`（使用 mock jmClient）

- [ ] **Step 1: 写失败测试（导出会枚举章节与页并写入 zip entry）**

测试用 mock `JMComicClient`：
- `fetchAlbumDetail()` 返回 series 列表
- `fetchChapterDetail()` 返回 images 列表
- `fetchImageResponse()` 返回固定 bytes
- `decryptImage()` 返回固定 bytes（可直接 bypass）

断言：
- zip writer 的 `addFile` 被调用次数与命名规则正确（例如 `album/<chapter_sort>-<chapter_id>/<page>.jpg`）

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 最小实现 ZipExporter**

实现要点（高性能约束）：
- 任务内部下载页并发受控（Semaphore）
- 逐页写入 zip，避免一次性 buffer 全章
- `image_format=original|webp|jpeg`：
  - original：依据上游 content-type 或 magic bytes 推断输出格式
  - webp/jpeg：调用现有 `encodeImage` 或新增 `encodeImageToFormat`

- [ ] **Step 4: 跑测试转绿**

---

## Task 7：ZipExporter(export_favorites_zip)

**Files:**
- Modify: `src/server/export/zipExporter.ts`
- Test: `src/server/export/zipExporterFavorites.test.ts`

- [ ] **Step 1: 写失败测试（favorites 分页 → 多 album 导出）**
- [ ] **Step 2: 实现分页拉取 favorites 并导出**
- [ ] **Step 3: 测试转绿**

---

## Task 8：任务路由（Hono）

**Files:**
- Create: `src/server/routes/tasks.ts`
- Modify: `src/server/index.ts`
- Test: `src/server/routes/tasks.test.ts`

- [ ] **Step 1: 写失败测试（创建任务 → 查询 → 下载）**
- [ ] **Step 2: 实现路由**
  - `POST /api/tasks/export/album`
  - `POST /api/tasks/export/favorites`
  - `GET /api/tasks/:id`
  - `POST /api/tasks/:id/cancel`
  - `GET /api/tasks/:id/download`
- [ ] **Step 3: 测试转绿**

---

## Task 9：manifest（客户端自打包）

**Files:**
- Create: `src/server/export/manifest.ts`
- Modify: `src/server/index.ts`（挂路由）
- Test: `src/server/export/manifest.test.ts`

- [ ] **Step 1: 写失败测试（manifest 返回章节/页/可拉取 URL）**
- [ ] **Step 2: 实现 `GET /api/export/album/:id/manifest`**
  - 返回章节排序、页文件名、以及 `buildImageProxyUrl` 可用的参数（或直接给 proxy URL）
- [ ] **Step 3: 测试转绿**

---

## Task 10：CLI（最小可用）

**Files:**
- Create: `cli/package.json`
- Create: `cli/tsconfig.json`
- Create: `cli/src/index.ts`
- Create: `cli/src/http.ts`
- Create: `cli/src/storage/sessionStore.ts`
- Create: `cli/src/commands/login.ts`
- Create: `cli/src/commands/exportAlbum.ts`
- Create: `cli/src/commands/exportFavorites.ts`
- (Reuse): `src/shared/schema.ts`（CLI 直接 import）

- [ ] **Step 1: CLI 基础工程与 `--origin`**
  - `node cli/src/index.ts --origin http://127.0.0.1:8787 ...`
  - 默认 origin：沿用现有 `getApiOrigin` 思路（CLI 端 default `http://127.0.0.1:8787`）

- [ ] **Step 2: login**
  - 调 `POST /api/auth/login`
  - 保存 `session_id`（本地文件）

- [ ] **Step 3: export album**
  - 创建任务
  - 轮询任务进度（指数退避 300ms → 2s 上限）
  - 成功后下载 zip 到本地（stream 写文件）
  - 用 Zod 校验 task payload

- [ ] **Step 4: export favorites**
  - 同上

---

## Task 11：可靠性与性能检查（非功能）

- [ ] 为任务 runner 增加超时/重试策略（网络错误可重试，鉴权错误直失败）
- [ ] 对导出接口加上合理的 headers（下载：`Content-Disposition`，`Cache-Control`）
- [ ] 对关键路径增加日志（任务耗时、导出页数、并发参数）

---

## 验证命令（每个阶段都可执行）

后端测试：
- `node --import tsx --test src/server/**/*.test.ts`

类型检查：
- `npm run typecheck`

本地联调：
- API：`npm run api`
- Web：`npm run dev`

CLI（计划完成后）：
- `node cli/src/index.ts --origin http://127.0.0.1:8787 login --username xxx --password yyy`
- `node cli/src/index.ts --origin http://127.0.0.1:8787 export-album 123456 --out ./downloads`

---

## 自检（写完计划后要做的检查）

- 覆盖 spec：会话隔离、任务系统、TTL、ZIP、manifest、CLI（都在 tasks 中有落点）
- 占位符扫描：无 TODO/TBD
- 类型一致性：task 状态字段名统一（queued/running/succeeded/failed/canceled/expired）

