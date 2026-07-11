# 下载任务中心与性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为下载页补充任务展示 metadata，重构成概览区/进行中/历史结果三区结构，完成态改为结果卡片，并在保持 SPA 低频刷新的前提下压低该页面的渲染和占用成本。

**Architecture:** 后端在任务 schema 和创建入口上补一层轻量 `metadata`，让前端无需二次详情请求也能渲染本子标题与章节数量。前端把下载页拆成稳定的三个区块，仅让活跃任务区跟随轮询变化，历史区使用更轻的结果态卡片与 memo 化展示，减少整页排序和整页重渲染。

**Tech Stack:** Remix, React, TypeScript, Hono, Zod, Node test runner, existing JM RPC/task manager stack

---

## File structure

- Modify: `src/server/task/types.ts`
  - 为任务补 `TaskMetadata` schema/type。
- Modify: `src/server/task/taskManager.ts`
  - 让 `TaskManager.create()` 支持元数据并原样保存在任务快照里。
- Modify: `src/server/routes/tasks.ts`
  - 创建单本/收藏夹下载任务时填充 metadata。
- Modify: `src/server/routes/tasks.test.ts`
  - 校验任务创建接口返回 metadata。
- Modify: `app/lib/jm-rpc.server.ts`
  - 扩展前端 task schema，使 `TaskSummary` 包含 metadata。
- Modify: `app/lib/tasks.ts`
  - 增加任务对象文案格式化、分区展示字段、`下载 ZIP` 文案、对象标题/章节数量格式化。
- Modify: `app/lib/task-queue.ts`
  - 补充分组 helper、历史区稳定排序、刷新边界 helper。
- Modify: `app/lib/task-queue.test.ts`
  - 为 metadata 展示、分组、稳定排序、自动下载与刷新边界补测试。
- Modify: `app/components/task-queue.tsx`
  - 拆成概览区 / 活跃区 / 历史区，完成态改成结果卡片。
- Modify: `app/components/task-queue.test.tsx`
  - 校验三块结构、完成态文案、下载对象展示。
- Modify: `app/routes/me.tasks.tsx`
  - 收紧轮询 effect、让渲染只消费分区结果。
- Modify: `app/routes/me.tasks.test.ts`
  - 校验 loader 返回值与自动刷新边界。
- Modify: `app/styles/components.css`
  - 为完成态卡片、区块分组和轻量样式补 CSS。
- Modify: `app/components/profile.tsx`
  - 如果复用任务摘要 helper，这里同步跟进新 metadata 展示与 `下载 ZIP` 文案。
- Modify: `app/components/profile.test.tsx`
  - 如受 helper 影响，更新展示测试。

### Task 1: 给任务模型补 metadata

**Files:**
- Modify: `src/server/task/types.ts`
- Modify: `src/server/task/taskManager.ts`
- Modify: `src/server/routes/tasks.ts`
- Modify: `src/server/routes/tasks.test.ts`
- Modify: `app/lib/jm-rpc.server.ts`

- [ ] **Step 1: 写失败测试，锁定任务 metadata 会随任务返回**

```ts
test("tasks route: export album returns task metadata with album title and chapter count", async () => {
  const app = createServerApp({
    sessionManager: {
      get() {
        return {
          client: {
            fetchAlbumDetail: async () => ({
              data: {
                name: "示例本子",
              },
            }),
          },
        };
      },
    },
  });

  const response = await app.request("/api/tasks/export/album", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      albumId: "123456",
      chapterIds: ["c1", "c2", "c3"],
      imageFormat: "webp",
    }),
  });

  const task = await response.json();
  assert.deepEqual(task.metadata, {
    targetType: "album",
    albumId: "123456",
    albumTitle: "示例本子",
    chapterCount: 3,
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test src/server/routes/tasks.test.ts --test-name-pattern "metadata"`  
Expected: FAIL，报 `metadata` 字段不存在或响应不匹配。

- [ ] **Step 3: 在任务 schema 和 task manager 中加入 metadata**

```ts
export const TaskMetadataSchema = z
  .object({
    targetType: z.enum(["album", "favorites"]),
    albumId: z.string().optional(),
    albumTitle: z.string().nullable().optional(),
    chapterCount: z.number().int().positive().nullable().optional(),
    folderId: z.string().nullable().optional(),
    folderName: z.string().nullable().optional(),
  })
  .strict();

export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

export type Task<TType extends TaskType = TaskType> = {
  id: string;
  type: TType;
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

```ts
create<TType extends TaskType>(
  type: TType,
  runner: TaskRunner<TType>,
  execution?: TaskExecutionOptions,
  metadata?: TaskMetadata,
): Task<TType> {
  const task: TaskInternal<TType> = {
    id,
    type,
    status: "queued",
    createdAt: this.now(),
    metadata,
    progress: defaultProgress(),
    runner,
    execution: normalizeExecutionOptions(execution),
    cancelRequested: false,
  };
}
```

- [ ] **Step 4: 在任务创建接口补 album/favorites metadata**

```ts
const albumDetail = await jmClient.fetchAlbumDetail(albumId).catch(() => null);
const albumTitle =
  typeof albumDetail?.data === "object" &&
  albumDetail?.data !== null &&
  "name" in albumDetail.data &&
  typeof albumDetail.data.name === "string"
    ? albumDetail.data.name
    : null;

const task = taskManager.create(
  "export_album_zip",
  async () => {
    // 保持原有导出逻辑
  },
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
  },
);
```

```ts
const task = taskManager.create(
  "export_favorites_zip",
  async () => {
    // 保持原有导出逻辑
  },
  {
    retry: {
      maxAttempts: 2,
      timeoutMs: DEFAULT_TASK_RUNNER_TIMEOUT_MS,
    },
  },
  {
    targetType: "favorites",
    folderId,
    folderName: folderId === "0" ? "全部收藏" : `收藏夹 ${folderId}`,
  },
);
```

- [ ] **Step 5: 让前端 RPC schema 读到 metadata**

```ts
const taskMetadataSchema = z
  .object({
    targetType: z.enum(["album", "favorites"]),
    albumId: z.string().optional(),
    albumTitle: z.string().nullable().optional(),
    chapterCount: z.number().int().positive().nullable().optional(),
    folderId: z.string().nullable().optional(),
    folderName: z.string().nullable().optional(),
  })
  .strict();

export const taskSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["export_album_zip", "export_favorites_zip"]),
    status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
    createdAt: z.number().int().nonnegative(),
    metadata: taskMetadataSchema.optional(),
    startedAt: z.number().int().nonnegative().optional(),
    finishedAt: z.number().int().nonnegative().optional(),
    progress: taskProgressSchema,
    result: taskResultSchema.optional(),
    error: taskErrorSchema.optional(),
  })
  .strict();
```

- [ ] **Step 6: 重新运行测试，确认 metadata 已打通**

Run: `node --import tsx --test src/server/routes/tasks.test.ts --test-name-pattern "metadata"`  
Expected: PASS

- [ ] **Step 7: 提交当前改动**

Run: `git rev-parse --is-inside-work-tree && git add src/server/task/types.ts src/server/task/taskManager.ts src/server/routes/tasks.ts src/server/routes/tasks.test.ts app/lib/jm-rpc.server.ts && git commit -m "feat: add download task metadata"`  
Expected: 如果当前目录是 git 仓库则成功提交；如果像当前工作区一样不是 git 仓库，则 `git rev-parse` 失败并跳过提交，继续后续任务。

### Task 2: 重写下载页 helper，支持对象标题、章节数和结果态

**Files:**
- Modify: `app/lib/tasks.ts`
- Modify: `app/lib/task-queue.ts`
- Modify: `app/lib/task-queue.test.ts`

- [ ] **Step 1: 写失败测试，锁定对象标题、章节数和“下载 ZIP”文案**

```ts
test("formatTaskDisplayTarget uses album title and chapter count from metadata", () => {
  assert.deepEqual(
    formatTaskDisplayTarget({
      type: "export_album_zip",
      status: "succeeded",
      createdAt: 1,
      progress: { total: 3, current: 3, currentLabel: null },
      metadata: {
        targetType: "album",
        albumId: "a1",
        albumTitle: "夜色本子",
        chapterCount: 3,
      },
    }),
    {
      title: "夜色本子",
      subtitle: "共 3 话",
    },
  );
});

test("getTaskDownloadState uses generic ZIP label", () => {
  assert.equal(
    getTaskDownloadState(
      {
        id: "task-1",
        type: "export_album_zip",
        status: "succeeded",
        createdAt: 1,
        progress: { total: 3, current: 3, currentLabel: null },
        result: {
          filePath: "/tmp/a.zip",
          fileName: "a.zip",
          size: 1024,
        },
      },
      { apiOrigin: "http://127.0.0.1:8787" },
    ).label,
    "下载 ZIP",
  );
});
```

- [ ] **Step 2: 运行 helper 测试，确认当前失败**

Run: `node --import tsx --test app/lib/task-queue.test.ts app/lib/tasks.server.test.ts`  
Expected: FAIL，缺少 `formatTaskDisplayTarget()` 或下载文案仍为 `下载 xxx.zip`。

- [ ] **Step 3: 为任务卡片补充展示 helper**

```ts
export function formatTaskDisplayTarget(task: TaskSummary): {
  title: string;
  subtitle: string | null;
} {
  if (task.metadata?.targetType === "album") {
    return {
      title: task.metadata.albumTitle?.trim() || `本子 ${task.metadata.albumId ?? ""}`.trim(),
      subtitle:
        typeof task.metadata.chapterCount === "number" && task.metadata.chapterCount > 1
          ? `共 ${task.metadata.chapterCount} 话`
          : null,
    };
  }

  if (task.metadata?.targetType === "favorites") {
    return {
      title: task.metadata.folderName?.trim() || "收藏夹",
      subtitle: null,
    };
  }

  return {
    title: formatTaskTypeLabel(task.type),
    subtitle: null,
  };
}
```

```ts
export function getTaskDownloadState(task: TaskForBadges, options?: TaskDownloadOptions): TaskDownloadState {
  const fileName = normalizeTaskFileName(task.result?.fileName);

  if (task.status === "succeeded" && fileName) {
    return {
      href: buildTaskDownloadUrl(task.id, options?.apiOrigin),
      label: "下载 ZIP",
      hint: "下载文件通常保留 2 小时，过期后请重新发起下载。",
      isReady: true,
    };
  }

  // 保持其他分支不变
}
```

- [ ] **Step 4: 为下载页补充分组和稳定历史区排序 helper**

```ts
export function partitionTaskQueue(tasks: TaskSummary[]) {
  const activeTasks: TaskSummary[] = [];
  const historyTasks: TaskSummary[] = [];

  for (const task of tasks) {
    if (task.status === "queued" || task.status === "running") {
      activeTasks.push(task);
    } else {
      historyTasks.push(task);
    }
  }

  activeTasks.sort((left, right) => right.createdAt - left.createdAt);
  historyTasks.sort((left, right) => {
    const rightTime = right.finishedAt ?? right.createdAt;
    const leftTime = left.finishedAt ?? left.createdAt;
    return rightTime - leftTime;
  });

  return { activeTasks, historyTasks };
}
```

```ts
export function buildTaskQueueOverview(tasks: TaskSummary[]) {
  const { activeTasks, historyTasks } = partitionTaskQueue(tasks);
  return {
    total: tasks.length,
    active: activeTasks.length,
    completed: historyTasks.filter((task) => task.status === "succeeded").length,
    failed: historyTasks.filter((task) => task.status === "failed" || task.status === "canceled").length,
  };
}
```

- [ ] **Step 5: 重新运行 helper 测试**

Run: `node --import tsx --test app/lib/task-queue.test.ts app/lib/tasks.server.test.ts`  
Expected: PASS

- [ ] **Step 6: 提交 helper 改动**

Run: `git rev-parse --is-inside-work-tree && git add app/lib/tasks.ts app/lib/task-queue.ts app/lib/task-queue.test.ts && git commit -m "feat: add download task display helpers"`  
Expected: 同 Task 1 的提交规则。

### Task 3: 重构下载页 UI，拆成概览 / 进行中 / 历史结果

**Files:**
- Modify: `app/components/task-queue.tsx`
- Modify: `app/components/task-queue.test.tsx`
- Modify: `app/styles/components.css`

- [ ] **Step 1: 写失败测试，锁定三区结构与完成态按钮文案**

```tsx
test("TaskQueuePanel renders active and history sections with ZIP button label", () => {
  const markup = renderToStaticMarkup(
    <TaskQueuePanel
      apiOrigin="http://127.0.0.1:8787"
      tasks={[
        {
          id: "running-1",
          type: "export_album_zip",
          status: "running",
          createdAt: 1,
          progress: { total: 12, current: 3, currentLabel: "第 3 话" },
          metadata: {
            targetType: "album",
            albumId: "a1",
            albumTitle: "夜色本子",
            chapterCount: 3,
          },
        },
        {
          id: "done-1",
          type: "export_album_zip",
          status: "succeeded",
          createdAt: 2,
          finishedAt: 4,
          progress: { total: 12, current: 12, currentLabel: null },
          metadata: {
            targetType: "album",
            albumId: "a1",
            albumTitle: "夜色本子",
            chapterCount: 3,
          },
          result: {
            filePath: "/tmp/a.zip",
            fileName: "a.zip",
            size: 1024,
          },
        },
      ]}
      page={1}
      pageCount={1}
      pageSize={20}
    />,
  );

  assert.match(markup, /进行中/);
  assert.match(markup, /已完成与失败/);
  assert.match(markup, /夜色本子/);
  assert.match(markup, /共 3 话/);
  assert.match(markup, /下载 ZIP/);
  assert.doesNotMatch(markup, /下载 a\.zip/);
});
```

- [ ] **Step 2: 运行组件测试，确认当前失败**

Run: `node --import tsx --test app/components/task-queue.test.tsx`  
Expected: FAIL，当前只有单一列表结构，且文案不匹配。

- [ ] **Step 3: 把 `TaskQueuePanel` 拆成三区结构**

```tsx
export function TaskQueuePanel(props: TaskQueuePanelProps) {
  const { activeTasks, historyTasks } = useMemo(
    () => partitionTaskQueue(props.tasks),
    [props.tasks],
  );
  const overview = useMemo(() => buildTaskQueueOverview(props.tasks), [props.tasks]);

  return (
    <div className="task-queue">
      <TaskQueueOverview overview={overview} refreshing={props.refreshing} />

      {activeTasks.length > 0 ? (
        <ActiveTaskSection tasks={activeTasks} apiOrigin={props.apiOrigin} />
      ) : null}

      <HistoryTaskSection tasks={historyTasks} apiOrigin={props.apiOrigin} />
    </div>
  );
}
```

```tsx
const TaskCard = memo(function TaskCard(props: {
  task: TaskSummary;
  apiOrigin?: string;
  variant: "active" | "history";
}) {
  const target = formatTaskDisplayTarget(props.task);
  const download = getTaskDownloadState(props.task, { apiOrigin: props.apiOrigin });
  const progress = getTaskProgressSnapshot(props.task);

  return (
    <article className={`task-queue__card task-queue__card--${props.variant}`}>
      <div className="task-queue__summary">
        <strong className="task-queue__title">{target.title}</strong>
        {target.subtitle ? <span className="task-queue__target-meta">{target.subtitle}</span> : null}
      </div>

      {props.variant === "active" ? (
        <ActiveTaskProgress progress={progress} currentLabel={props.task.progress.currentLabel} />
      ) : (
        <HistoryTaskResult task={props.task} download={download} />
      )}
    </article>
  );
});
```

- [ ] **Step 4: 为完成态和历史区补轻量样式**

```css
.task-queue__sections {
  display: grid;
  gap: 16px;
}

.task-queue__section {
  display: grid;
  gap: 12px;
  padding: 20px;
}

.task-queue__history-list,
.task-queue__active-list {
  display: grid;
  gap: 12px;
}

.task-queue__card--history {
  background: var(--md-sys-color-surface-container);
}

.task-queue__completion-bar {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--md-sys-color-tertiary) 78%, white);
}

.task-queue__download-button {
  min-width: 120px;
}
```

- [ ] **Step 5: 如 profile 摘要复用 helper，同步更新测试**

```tsx
assert.match(markup, /下载 ZIP/);
assert.match(markup, /夜色本子/);
assert.doesNotMatch(markup, /下载 .*\.zip/);
```

- [ ] **Step 6: 重新运行组件和展示测试**

Run: `node --import tsx --test app/components/task-queue.test.tsx app/components/profile.test.tsx`  
Expected: PASS

- [ ] **Step 7: 提交 UI 改动**

Run: `git rev-parse --is-inside-work-tree && git add app/components/task-queue.tsx app/components/task-queue.test.tsx app/styles/components.css app/components/profile.tsx app/components/profile.test.tsx && git commit -m "feat: redesign download task cards"`  
Expected: 同 Task 1 的提交规则。

### Task 4: 收紧下载页刷新边界并做完整回归

**Files:**
- Modify: `app/routes/me.tasks.tsx`
- Modify: `app/routes/me.tasks.test.ts`
- Modify: `app/lib/task-queue.test.ts`

- [ ] **Step 1: 写失败测试，锁定只有活跃区会被轮询驱动**

```ts
test("partitionTaskQueue keeps history tasks out of active section", () => {
  const tasks = [
    {
      id: "done-1",
      type: "export_album_zip",
      status: "succeeded",
      createdAt: 1,
      finishedAt: 2,
      progress: { total: 1, current: 1, currentLabel: null },
      metadata: {
        targetType: "album",
        albumId: "a1",
        albumTitle: "夜色本子",
        chapterCount: 1,
      },
      result: {
        filePath: "/tmp/a.zip",
        fileName: "a.zip",
        size: 100,
      },
    },
  ];

  const { activeTasks, historyTasks } = partitionTaskQueue(tasks);
  assert.equal(activeTasks.length, 0);
  assert.equal(historyTasks.length, 1);
});
```

```ts
test("me.tasks loader still exposes apiOrigin and task metadata eagerly", async () => {
  meTasksLoaderDependencies.fetchTaskList = async () => [
    {
      id: "task-1",
      type: "export_album_zip",
      status: "queued",
      createdAt: 10,
      metadata: {
        targetType: "album",
        albumId: "a1",
        albumTitle: "夜色本子",
        chapterCount: 2,
      },
      progress: { total: null, current: 0, currentLabel: null },
    },
  ];
  meTasksLoaderDependencies.getApiOrigin = () => "http://127.0.0.1:8787";

  const response = await loader({
    request: new Request("http://localhost:3000/me/tasks?page=1"),
    params: {},
    context: {},
  } as LoaderFunctionArgs);

  assert.deepEqual(await response.json(), {
    apiOrigin: "http://127.0.0.1:8787",
    page: 1,
    pageSize: 20,
    tasks: [
      {
        id: "task-1",
        type: "export_album_zip",
        status: "queued",
        createdAt: 10,
        metadata: {
          targetType: "album",
          albumId: "a1",
          albumTitle: "夜色本子",
          chapterCount: 2,
        },
        progress: { total: null, current: 0, currentLabel: null },
      },
    ],
  });
});
```

- [ ] **Step 2: 运行下载页相关测试，确认当前失败**

Run: `node --import tsx --test app/routes/me.tasks.test.ts app/lib/task-queue.test.ts`  
Expected: FAIL，当前未针对 metadata 和分区结构断言。

- [ ] **Step 3: 把下载页路由改为只消费分区结果，不在路由层做额外整页排序**

```tsx
export default function MeTasksRoute() {
  const data = useLoaderData<typeof loader>() as unknown as TasksPageData;
  const revalidator = useRevalidator();
  const previousTasksRef = useRef<TaskSummary[]>(data.tasks);
  const handledAutoDownloadsRef = useRef<Set<string>>(new Set());
  const [visibilityState, setVisibilityState] = useState(() =>
    typeof document === "undefined" ? "visible" : document.visibilityState,
  );

  const shouldRefresh = shouldAutoRefreshTaskQueue({
    visibilityState,
    revalidatorState: revalidator.state,
    tasks: data.tasks,
  });

  useEffect(() => {
    if (!shouldRefresh) return;
    const timerId = window.setInterval(() => {
      revalidator.revalidate();
    }, 3000);
    return () => window.clearInterval(timerId);
  }, [revalidator, shouldRefresh]);

  useEffect(() => {
    const taskId = findAutoDownloadTaskId({
      previousTasks: previousTasksRef.current,
      nextTasks: data.tasks,
      handledTaskIds: handledAutoDownloadsRef.current,
    });

    previousTasksRef.current = data.tasks;
    if (!taskId) return;

    const anchor = document.createElement("a");
    anchor.href = buildTaskDownloadUrl(taskId, data.apiOrigin);
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    handledAutoDownloadsRef.current.add(taskId);
  }, [data.apiOrigin, data.tasks]);

  return (
    <TaskQueuePanel
      apiOrigin={data.apiOrigin}
      tasks={data.tasks}
      page={data.page}
      pageCount={Math.max(1, Math.ceil(data.tasks.length / data.pageSize))}
      pageSize={data.pageSize}
      refreshing={revalidator.state !== "idle"}
    />
  );
}
```

- [ ] **Step 4: 跑完整回归**

Run: `npm run -s typecheck && node --import tsx --test src/server/routes/tasks.test.ts app/lib/tasks.server.test.ts app/lib/task-queue.test.ts app/components/task-queue.test.tsx app/components/profile.test.tsx app/routes/me.tasks.test.ts 'app/routes/manga.$id.test.ts'`  
Expected: typecheck 通过，全部测试 PASS。

- [ ] **Step 5: 手动验证关键路径**

Run:

```bash
open "http://localhost:3000/me/tasks"
```

Expected:

- 下载页分成概览区、进行中、已完成与失败。
- 已完成任务按钮文案为 `下载 ZIP`。
- 单本任务显示本子标题。
- 多话任务显示 `共 N 话`。
- 下载页在无活跃任务时不会持续刷新。

- [ ] **Step 6: 提交最终改动**

Run: `git rev-parse --is-inside-work-tree && git add src/server/task/types.ts src/server/task/taskManager.ts src/server/routes/tasks.ts src/server/routes/tasks.test.ts app/lib/jm-rpc.server.ts app/lib/tasks.ts app/lib/task-queue.ts app/lib/task-queue.test.ts app/components/task-queue.tsx app/components/task-queue.test.tsx app/routes/me.tasks.tsx app/routes/me.tasks.test.ts app/styles/components.css app/components/profile.tsx app/components/profile.test.tsx && git commit -m "feat: optimize download task center"`  
Expected: 同 Task 1 的提交规则。

## Self-review

- **Spec coverage:** 已覆盖 metadata、三区结构、完成态卡片、`下载 ZIP` 文案、对象标题/章节数、SPA 低频刷新、自动下载与 2 小时保留不回退。
- **Placeholder scan:** 计划中未保留 TBD/TODO；收藏夹作品数已明确不在本次范围。
- **Type consistency:** 统一使用 `metadata`, `formatTaskDisplayTarget`, `partitionTaskQueue`, `TaskQueuePanel`, `buildTaskDownloadUrl` 这些名称，避免前后不一致。
