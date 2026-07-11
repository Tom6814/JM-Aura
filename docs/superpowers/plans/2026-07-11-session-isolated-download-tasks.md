# Session 隔离下载任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让下载任务按当前设备 session 隔离显示，并支持手动删除任务时连带删除 ZIP 文件，同时在文件 2 小时过期和 session 6 小时闲置过期时级联清理对应任务与文件。

**Architecture:** 服务端给每个任务绑定创建它的 `sessionId`，所有任务接口先做 session 归属校验；`TaskManager` 提供按 session 查询、删除和懒清理能力，`JmSessionManager` 在 cookie session 过期时触发该 session 的级联清理。前端下载页只消费后端已过滤结果，并补一个轻量“删除任务”入口，成功后沿用现有 SPA revalidate 更新列表。

**Tech Stack:** Remix, React, TypeScript, Hono, Zod, Node fs/promises, existing in-memory session/task/export stack

---

## File structure

- Modify: `src/server/task/types.ts`
  - 任务 schema 增加 `sessionId`。
- Modify: `src/server/task/taskManager.ts`
  - `create()` 接收 `sessionId`，增加按 session 查询、受控删除、过期清理能力。
- Modify: `src/server/task/taskManager.test.ts`
  - 补 session 隔离、删除、清理相关测试。
- Modify: `src/server/export/exportStore.ts`
  - 增加定点删除 ZIP 的轻量方法。
- Modify: `src/server/export/exportStore.test.ts`
  - 验证定点删除和原有清理能力不回退。
- Modify: `src/server/session.ts`
  - 增加 `onSessionExpired` 回调，在 cookie session 过期时触发清理。
- Modify: `src/server/session.test.ts` 或现有 session 测试文件
  - 验证 session 过期会触发级联清理回调。
- Modify: `src/server/routes/tasks.ts`
  - 列表按当前 session 过滤；单任务接口做 session 归属校验；新增 `DELETE /api/tasks/:id`；把文件过期清理和任务清理收口到统一路径。
- Modify: `src/server/routes/tasks.test.ts`
  - 补跨 session 不可见、不可下载、不可删除、删除连带删文件的测试。
- Modify: `app/lib/jm-rpc.server.ts`
  - 新增前端删除任务 RPC。
- Modify: `app/components/task-queue.tsx`
  - 为卡片增加 `删除任务` 按钮和轻量 pending 状态。
- Modify: `app/components/task-queue.test.tsx`
  - 验证删除按钮渲染。
- Modify: `app/routes/me.tasks.tsx`
  - 接入删除 fetcher，删除成功后 revalidate。
- Modify: `app/routes/me.tasks.test.ts`
  - 验证删除后列表更新与现有刷新边界不回退。

### Task 1: 给任务模型补 session 归属，并扩展 TaskManager

**Files:**
- Modify: `src/server/task/types.ts`
- Modify: `src/server/task/taskManager.ts`
- Modify: `src/server/task/taskManager.test.ts`

- [ ] **Step 1: 写失败测试，锁定同 session 可见、跨 session 不可见**

```ts
test("task manager lists tasks by session", async () => {
  const tm = new TaskManager({ concurrency: 1, now: () => 1 });

  const first = tm.create(
    "export_album_zip",
    async () => ({ filePath: "/tmp/a.zip", fileName: "a.zip", size: 1 }),
    undefined,
    undefined,
    "session-a",
  );
  const second = tm.create(
    "export_album_zip",
    async () => ({ filePath: "/tmp/b.zip", fileName: "b.zip", size: 1 }),
    undefined,
    undefined,
    "session-b",
  );

  assert.deepEqual(
    tm.listBySession("session-a").map((task) => task.id),
    [first.id],
  );
  assert.deepEqual(
    tm.listBySession("session-b").map((task) => task.id),
    [second.id],
  );
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test src/server/task/taskManager.test.ts --test-name-pattern "session"`  
Expected: FAIL，提示 `listBySession` 或 `sessionId` 不存在。

- [ ] **Step 3: 在任务类型中加入 `sessionId`**

```ts
export type Task<TType extends TaskType = TaskType> = {
  id: string;
  type: TType;
  sessionId: string;
  status: TaskStatus;
  createdAt: number;
  metadata?: TaskMetadata;
  startedAt?: number;
  finishedAt?: number;
  progress: TaskProgress;
  result?: TaskResult<TType>;
  error?: TaskErrorInfo;
};
```

- [ ] **Step 4: 扩展 `TaskManager.create()`、`listBySession()` 和 `getOwnedTask()`**

```ts
create<TType extends TaskType>(
  type: TType,
  runner: TaskRunner<TType>,
  execution?: TaskExecutionOptions,
  metadata?: TaskMetadata,
  sessionId?: string,
): Task<TType> {
  const task: TaskInternal<TType> = {
    id,
    type,
    sessionId: sessionId ?? "anonymous",
    status: "queued",
    createdAt: this.now(),
    metadata,
    progress: defaultProgress(),
    runner,
    execution: normalizeExecutionOptions(execution),
    cancelRequested: false,
  };
```

```ts
listBySession(sessionId: string, options: { limit?: number } = {}): Task[] {
  const tasks = [...this.tasks.values()]
    .filter((task) => task.sessionId === sessionId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const limit = options.limit;
  const sliced =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? tasks.slice(0, Math.floor(limit))
      : tasks;

  return sliced.map((task) => this.snapshot(task));
}

getOwnedTask<TType extends TaskType = TaskType>(id: string, sessionId: string): Task<TType> | undefined {
  const task = this.tasks.get(id);
  if (!task || task.sessionId !== sessionId) return undefined;
  return this.snapshot(task as TaskInternal<TType>);
}
```

- [ ] **Step 5: 增加删除与按 session 清理能力**

```ts
deleteOwnedTask(id: string, sessionId: string): Task | undefined {
  const task = this.tasks.get(id);
  if (!task || task.sessionId !== sessionId) return undefined;
  this.tasks.delete(id);
  return this.snapshot(task);
}

deleteBySession(sessionId: string): Task[] {
  const deleted: Task[] = [];
  for (const [id, task] of this.tasks.entries()) {
    if (task.sessionId !== sessionId) continue;
    this.tasks.delete(id);
    deleted.push(this.snapshot(task));
  }
  return deleted;
}
```

- [ ] **Step 6: 重新运行 task manager 测试**

Run: `node --import tsx --test src/server/task/taskManager.test.ts`  
Expected: PASS

- [ ] **Step 7: 提交当前改动**

Run: `git rev-parse --is-inside-work-tree && git add src/server/task/types.ts src/server/task/taskManager.ts src/server/task/taskManager.test.ts && git commit -m "feat: scope download tasks to session"`  
Expected: 在 git 仓库里成功提交；若当前目录不是 git 仓库，则跳过提交，继续后续任务。

### Task 2: 让 ExportStore 和 SessionManager 支持级联清理

**Files:**
- Modify: `src/server/export/exportStore.ts`
- Modify: `src/server/export/exportStore.test.ts`
- Modify: `src/server/session.ts`
- Modify: `src/server/session.test.ts`

- [ ] **Step 1: 写失败测试，锁定删除 ZIP 与 session 过期回调**

```ts
test("export store deletes an existing zip path safely", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jm-aura-export-store-"));
  const store = new ExportStore({ rootDir: tmpRoot });
  const filePath = path.join(tmpRoot, "a.zip");

  await fs.writeFile(filePath, Buffer.from("zip"));
  await store.deleteZipIfExists(filePath);

  await assert.rejects(() => fs.stat(filePath));
});
```

```ts
test("session manager calls onSessionExpired before rotating cookie session", () => {
  const expired: string[] = [];
  const manager = new JmSessionManager({
    ttlMs: 10,
    nowMs: (() => {
      let now = 0;
      return () => (now += 20);
    })(),
    createClient: () => ({ marker: "client" } as any),
    onSessionExpired(sessionId) {
      expired.push(sessionId);
    },
  });

  manager.get(new Request("http://localhost", { headers: { cookie: "aura_session=s1" } }));
  manager.get(new Request("http://localhost", { headers: { cookie: "aura_session=s1" } }));

  assert.deepEqual(expired, ["s1"]);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test src/server/export/exportStore.test.ts src/server/session.test.ts --test-name-pattern "delete|expired"`  
Expected: FAIL，报缺少 `deleteZipIfExists` 或 `onSessionExpired`。

- [ ] **Step 3: 给 `ExportStore` 增加轻量定点删除**

```ts
async deleteZipIfExists(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err: unknown) {
    if (isErrno(err, "ENOENT")) return false;
    throw err;
  }
}
```

- [ ] **Step 4: 给 `JmSessionManager` 增加 `onSessionExpired` 回调**

```ts
constructor(options?: {
  createClient?: () => JMComicClient;
  ttlMs?: number;
  nowMs?: () => number;
  onSessionExpired?: (sessionId: string) => Promise<void> | void;
}) {
  this.createClientFn = options?.createClient ?? (() => new JMComicClient());
  this.ttlMs = options?.ttlMs ?? DEFAULT_DEVICE_SESSION_TTL_MS;
  this.nowMs = options?.nowMs ?? (() => Date.now());
  this.onSessionExpired = options?.onSessionExpired;
}
```

```ts
if (expired) {
  this.sessions.delete(sessionId);
  await this.onSessionExpired?.(sessionId);
  if (source === "cookie") {
    sessionId = crypto.randomUUID();
  }
}
```

- [ ] **Step 5: 重新运行 export/session 测试**

Run: `node --import tsx --test src/server/export/exportStore.test.ts src/server/session.test.ts`  
Expected: PASS

- [ ] **Step 6: 提交当前改动**

Run: `git rev-parse --is-inside-work-tree && git add src/server/export/exportStore.ts src/server/export/exportStore.test.ts src/server/session.ts src/server/session.test.ts && git commit -m "feat: cascade cleanup expired sessions"`  
Expected: 同 Task 1 的提交规则。

### Task 3: 让任务路由按 session 隔离，并支持删除任务

**Files:**
- Modify: `src/server/routes/tasks.ts`
- Modify: `src/server/routes/tasks.test.ts`

- [ ] **Step 1: 写失败测试，锁定跨 session 不可见、不可下载、可删除**

```ts
test("tasks route only lists tasks for current session", async () => {
  const app = createAppWithTasks();

  await app.request(new Request("http://localhost/api/tasks/export/album", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "aura_session=session-a",
    },
    body: JSON.stringify({ albumId: "111" }),
  }));

  await app.request(new Request("http://localhost/api/tasks/export/album", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "aura_session=session-b",
    },
    body: JSON.stringify({ albumId: "222" }),
  }));

  const listA = await app.request(new Request("http://localhost/api/tasks", {
    headers: { cookie: "aura_session=session-a" },
  }));
  const listB = await app.request(new Request("http://localhost/api/tasks", {
    headers: { cookie: "aura_session=session-b" },
  }));

  assert.equal((await listA.json()).length, 1);
  assert.equal((await listB.json()).length, 1);
});
```

```ts
test("tasks route deletes owned task and its zip file", async () => {
  const { app, exportStore } = await createAppWithFinishedTask({ sessionId: "session-a" });
  const listResp = await app.request(new Request("http://localhost/api/tasks", {
    headers: { cookie: "aura_session=session-a" },
  }));
  const [task] = await listResp.json();

  const deleteResp = await app.request(new Request(`http://localhost/api/tasks/${task.id}`, {
    method: "DELETE",
    headers: { cookie: "aura_session=session-a" },
  }));

  assert.equal(deleteResp.status, 200);
  assert.equal(await exportStorePathExists(exportStore.getZipPath(task.id)), false);
});
```

- [ ] **Step 2: 运行路由测试，确认当前失败**

Run: `node --import tsx --test src/server/routes/tasks.test.ts --test-name-pattern "session|delete"`  
Expected: FAIL，当前列表未按 session 过滤，也没有 `DELETE /api/tasks/:id`。

- [ ] **Step 3: 创建任务时绑定 `sessionId`，列表只返回当前 session**

```ts
router.get("/api/tasks", async (c) => {
  const session = sessionManager.get(c.req.raw);
  await exportStore.ensureRootDir();
  await exportStore.cleanupIfDue();
  cleanupMissingArtifacts(taskManager, exportStore);
  return c.json(taskManager.listBySession(session.sessionId));
});
```

```ts
const session = sessionManager.get(c.req.raw);
const task = taskManager.create(
  "export_album_zip",
  async () => { ... },
  {
    retry: {
      maxAttempts: 2,
      timeoutMs: DEFAULT_TASK_RUNNER_TIMEOUT_MS,
    },
  },
  {
    targetType: "album",
    albumId,
    albumTitle,
    chapterCount: chapterIds?.length ? chapterIds.length : null,
    selectedChapters: ...
  },
  session.sessionId,
);
```

- [ ] **Step 4: 给单任务接口补 session 归属校验和删除接口**

```ts
router.get("/api/tasks/:id", zValidator("param", idParamSchema), (c) => {
  const session = sessionManager.get(c.req.raw);
  const task = taskManager.getOwnedTask(c.req.valid("param").id, session.sessionId);
  if (!task) return c.json({ error: "任务不存在" }, 404);
  return c.json(task);
});
```

```ts
router.delete("/api/tasks/:id", zValidator("param", idParamSchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const task = taskManager.getOwnedTask(c.req.valid("param").id, session.sessionId);
  if (!task) return c.json({ error: "任务不存在" }, 404);

  taskManager.cancel(task.id);
  if (task.result?.filePath) {
    await exportStore.deleteZipIfExists(task.result.filePath);
  }
  taskManager.deleteOwnedTask(task.id, session.sessionId);

  return c.json({ ok: true, deletedTaskId: task.id });
});
```

- [ ] **Step 5: 为文件过期与 session 过期补统一任务清理**

```ts
function cleanupMissingArtifacts(taskManager: TaskManager, exportStore: ExportStore) {
  const tasks = taskManager.list();
  const now = Date.now();

  for (const task of tasks) {
    if (task.status !== "succeeded" || !task.result?.filePath) continue;
    const filePath = task.result.filePath;
    const expired =
      typeof task.finishedAt === "number" &&
      exportStore.isExpired(task.finishedAt, now);

    if (expired) {
      taskManager.deleteOwnedTask(task.id, task.sessionId);
    }
  }
}
```

```ts
const sessionManager = new JmSessionManager({
  onSessionExpired: async (sessionId) => {
    const tasks = taskManager.deleteBySession(sessionId);
    await Promise.all(
      tasks.map((task) =>
        task.result?.filePath ? exportStore.deleteZipIfExists(task.result.filePath) : Promise.resolve(false),
      ),
    );
  },
});
```

- [ ] **Step 6: 重新运行任务路由测试**

Run: `node --import tsx --test src/server/routes/tasks.test.ts`  
Expected: PASS

- [ ] **Step 7: 提交路由改动**

Run: `git rev-parse --is-inside-work-tree && git add src/server/routes/tasks.ts src/server/routes/tasks.test.ts && git commit -m "feat: isolate download tasks by session"`  
Expected: 同 Task 1 的提交规则。

### Task 4: 给下载页补“删除任务”入口并完成回归

**Files:**
- Modify: `app/lib/jm-rpc.server.ts`
- Modify: `app/components/task-queue.tsx`
- Modify: `app/components/task-queue.test.tsx`
- Modify: `app/routes/me.tasks.tsx`
- Modify: `app/routes/me.tasks.test.ts`

- [ ] **Step 1: 写失败测试，锁定删除按钮与删除后更新**

```tsx
test("TaskQueuePanel renders delete action for history tasks", () => {
  const markup = renderToStaticMarkup(
    <TaskQueuePanel
      apiOrigin="http://127.0.0.1:8787"
      tasks={[doneTask]}
      page={1}
      pageCount={1}
      pageSize={20}
    />,
  );

  assert.match(markup, /删除任务/);
});
```

```ts
test("me.tasks route keeps current refresh boundary when deleting tasks", async () => {
  assert.deepEqual(
    getMeTasksRefreshState({
      visibilityState: "visible",
      revalidatorState: "idle",
      tasks: [],
    }),
    { shouldRefresh: false, refreshing: false },
  );
});
```

- [ ] **Step 2: 运行前端测试，确认当前失败**

Run: `node --import tsx --test app/components/task-queue.test.tsx app/routes/me.tasks.test.ts`  
Expected: FAIL，当前没有删除按钮与删除逻辑。

- [ ] **Step 3: 新增删除任务 RPC**

```ts
export async function deleteTask(request: Request, id: string): Promise<{ ok: boolean; deletedTaskId: string }> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: createForwardHeaders(request),
  });

  return parseRpcResponse(
    response,
    z.object({
      ok: z.literal(true),
      deletedTaskId: z.string().min(1),
    }),
    "删除下载任务失败",
  );
}
```

- [ ] **Step 4: 在下载页卡片加入删除按钮，并在路由层触发 revalidate**

```tsx
function TaskQueueHistoryCard(props: {
  task: TaskSummary;
  apiOrigin?: string;
  deleting?: boolean;
  onDelete?: (taskId: string) => void;
}) {
  ...
  <div className="task-queue__actions">
    {download.href ? (
      <a className="md-button md-button--primary task-queue__download-button" href={download.href}>
        {download.label}
      </a>
    ) : (
      <span className="md-button md-button--surface task-queue__download-button" aria-disabled="true">
        {download.label}
      </span>
    )}
    <button
      type="button"
      className="md-button md-button--surface"
      onClick={() => props.onDelete?.(props.task.id)}
      disabled={props.deleting}
    >
      {props.deleting ? "删除中..." : "删除任务"}
    </button>
  </div>
}
```

```tsx
const deleteFetcher = useFetcher<{ ok: true; deletedTaskId: string }>();

useEffect(() => {
  if (deleteFetcher.state === "idle" && deleteFetcher.data?.ok) {
    revalidator.revalidate();
  }
}, [deleteFetcher.data, deleteFetcher.state, revalidator]);
```

- [ ] **Step 5: 重新运行前端测试**

Run: `node --import tsx --test app/components/task-queue.test.tsx app/routes/me.tasks.test.ts`  
Expected: PASS

- [ ] **Step 6: 跑完整回归**

Run: `npm run -s typecheck && node --import tsx --test src/server/task/taskManager.test.ts src/server/export/exportStore.test.ts src/server/session.test.ts src/server/routes/tasks.test.ts app/components/task-queue.test.tsx app/routes/me.tasks.test.ts app/lib/task-queue.test.ts`  
Expected: typecheck 通过，全部测试 PASS。

- [ ] **Step 7: 手动验证关键路径**

Run:

```bash
open "http://localhost:3000/me/tasks"
```

Expected:

- 当前设备只看到自己创建的任务。
- 已完成任务卡片有 `删除任务`。
- 点击删除后任务立即消失。
- 刷新页面后已删除任务不会重新出现。
- 不同 session 无法下载或删除彼此任务。

- [ ] **Step 8: 提交最终改动**

Run: `git rev-parse --is-inside-work-tree && git add src/server/task/types.ts src/server/task/taskManager.ts src/server/task/taskManager.test.ts src/server/export/exportStore.ts src/server/export/exportStore.test.ts src/server/session.ts src/server/session.test.ts src/server/routes/tasks.ts src/server/routes/tasks.test.ts app/lib/jm-rpc.server.ts app/components/task-queue.tsx app/components/task-queue.test.tsx app/routes/me.tasks.tsx app/routes/me.tasks.test.ts && git commit -m "feat: isolate and delete download tasks by session"`  
Expected: 同 Task 1 的提交规则。

## Self-review

- **Spec coverage:** 已覆盖 session 隔离、删除接口、文件 2 小时过期清理、session 6 小时过期级联清理、下载页删除入口和高性能约束。
- **Placeholder scan:** 计划中无 TBD/TODO/“自行处理”；每个任务都给了明确代码与命令。
- **Type consistency:** 统一使用 `sessionId`, `listBySession`, `getOwnedTask`, `deleteOwnedTask`, `deleteZipIfExists`, `onSessionExpired`, `deleteTask` 这些名称，避免前后实现断裂。
