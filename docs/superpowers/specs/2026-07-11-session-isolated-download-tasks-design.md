# Session 隔离下载任务设计

日期：2026-07-11  
项目：`JM-Aura-Remix`

## 背景

当前下载任务是全局内存列表，虽然已经具备进度展示、自动下载、2 小时文件保留和手动下载能力，但存在两个明显问题：

1. 不同浏览器设备 session 之间可能看到彼此的下载任务。
2. 任务与文件的清理逻辑还不统一，缺少“手动删除任务时连带删除文件”和“session 过期时连带删除该 session 下全部任务与文件”的闭环。

本次目标是在不引入重型存储和常驻后台清理器的前提下，让下载任务按设备 session 隔离显示，并保证文件与任务记录始终同步删除。

## 目标

- 下载任务仅对当前设备 session 可见。
- 非当前 session 的任务不能被读取、下载、取消或删除。
- 用户可手动删除自己的下载任务。
- 手动删除任务时，对应 ZIP 文件和任务记录一起删除。
- ZIP 文件 2 小时过期后，任务记录也一起删除。
- 设备 session 6 小时闲置过期后，该 session 下的全部任务和 ZIP 文件一起删除。
- 以上逻辑保持高性能，不引入额外重轮询、复杂索引或常驻清理进程。

## 非目标

- 不做跨设备共享下载任务。
- 不按 JM 登录账号隔离任务。
- 不引入数据库或持久化任务表。
- 不改变现有下载任务执行模型和 SPA 低频刷新策略。

## 设计概览

核心思路是给每个下载任务绑定创建它的设备 `sessionId`，然后所有任务相关接口都先做 session 归属校验。

同时，把“任务记录删除”和“ZIP 文件删除”收敛成统一的资源清理路径，覆盖三种入口：

1. 用户手动删除
2. ZIP 文件 2 小时过期
3. 设备 session 6 小时闲置过期

性能策略保持轻量：

- 任务仍然存内存 Map
- 文件仍然走现有导出目录
- 不新增后台 worker
- 清理继续采用“懒触发”方式

## 数据模型

### 任务新增 session 归属

在现有 `Task` 上增加：

```ts
type Task<TType extends TaskType = TaskType> = {
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

说明：

- `sessionId` 只用于服务端归属判断，不需要前端展示。
- 任务快照是否返回 `sessionId` 给前端不是必须；为了减少无关数据暴露，可以不返回给前端。

## 接口行为

### 列表接口

`GET /api/tasks`

- 只返回当前设备 session 的任务。
- 返回前先做一次轻量懒清理：
  - 清理过期 ZIP
  - 清理失效任务记录

### 单任务接口

以下接口全部先做 session 归属校验：

- `GET /api/tasks/:id`
- `POST /api/tasks/:id/cancel`
- `GET /api/tasks/:id/download`
- `DELETE /api/tasks/:id`

如果任务不存在，或者任务不属于当前 session，统一按“不存在”处理，不暴露额外信息。

### 删除接口

新增：

`DELETE /api/tasks/:id`

行为：

- 如果任务属于当前 session：
  - 若任务是 `queued/running`，先标记取消
  - 删除已生成 ZIP 文件（如果存在）
  - 删除任务记录
- 返回删除后的轻量确认结果，例如：

```json
{
  "ok": true,
  "deletedTaskId": "..."
}
```

## 清理策略

### 文件 2 小时过期

当前 `ExportStore` 已支持 ZIP 文件 TTL 过期删除。  
本次补充要求：

- ZIP 文件被删除后，对应任务记录也一起删除。

做法：

- `ExportStore.cleanupIfDue()` 仍负责文件删除。
- 任务层新增一个基于 `filePath` 的轻量清理：
  - 如果任务是 `succeeded`
  - 且对应 `filePath` 已不存在或已过期
  - 删除该任务记录

### session 6 小时闲置过期

当前 `JmSessionManager` 在 cookie session 超过 TTL 后会：

- 丢弃旧 session
- 分配新 session id

本次补充要求：

- 在丢弃旧 session 前，清理该 session 关联的所有下载任务和 ZIP 文件。

做法：

- `JmSessionManager` 增加一个可选的 session 过期回调，例如：

```ts
onSessionExpired?: (sessionId: string) => Promise<void> | void;
```

- 当 cookie session 被判定为过期时：
  - 先触发该回调
  - 回调中删除该 session 下全部任务与 ZIP 文件
  - 再分配新 session

这仍然属于懒触发，不需要独立定时器。

## 服务端结构

### TaskManager 能力扩展

`TaskManager` 增加轻量能力：

- `create(..., sessionId)`
- `listBySession(sessionId)`
- `getOwnedTask(id, sessionId)`
- `delete(id, sessionId)` 或等价的受控删除方法
- `cleanupExpiredTasks(...)`
- `deleteBySession(sessionId)`

要求：

- 仍以单个内存 `Map<string, TaskInternal>` 为主存储
- 不引入额外复杂索引结构
- 遍历删除允许是 O(n)，因为当前任务量级很小，且触发频率低

### ExportStore 配合

`ExportStore` 补充轻量删除能力：

- `deleteZipIfExists(filePath)`

用于：

- 手动删除任务时删文件
- session 过期时删文件
- 清理历史孤儿文件时兜底

## 前端行为

### 下载页

前端不需要知道 sessionId。  
它只依赖后端已经过滤后的结果。

但下载页会新增一个删除入口：

- 对每张任务卡片增加 `删除任务`
- 点击后调用 `DELETE /api/tasks/:id`
- 删除成功后用现有 SPA revalidate 更新列表

### 删除交互

为了保持轻量：

- 不做复杂弹窗流程
- 使用简单确认交互即可
- 删除后直接从列表消失

## 性能约束

本次必须保持高性能，明确约束如下：

- 不引入数据库
- 不引入 websocket
- 不引入常驻后台清理器
- 不引入全局复杂多索引任务表
- 不提高下载页轮询频率
- session 清理、过期清理、手动删除都走低频懒触发

允许的低成本操作：

- 小规模内存 Map 遍历
- 基于 `filePath` 的定点文件删除
- 每次相关请求触发一次懒清理

## 错误处理

### 非本 session 的任务

所有任务接口统一表现为：

- `404 任务不存在` 或等价响应

不区分：

- 任务确实不存在
- 任务属于别的 session

### 删除不存在的任务

- 返回 `404`

### 删除正在运行任务

- 返回成功
- 内部先请求取消，再删除记录和文件
- 如果底层任务 runner 稍后还尝试写文件，导出层需容忍文件缺失或中断

## 测试

### 服务端测试

需要补这些用例：

- 同一 session 创建的任务，只能被该 session 列表看到
- 不同 session 看不到彼此任务
- 不同 session 无法下载/取消/删除别人的任务
- 手动删除成功任务时，任务与 ZIP 一起删除
- 手动删除运行中任务时，任务被取消并删除
- 文件 2 小时过期后，任务记录也一起删除
- session 6 小时过期后，该 session 下全部任务与 ZIP 一起删除

### 前端测试

- 删除按钮渲染正确
- 删除成功后列表更新
- 下载页在 session 过滤后仍正常分区显示

## 风险与取舍

### 不做多索引

理论上可以额外维护：

- `sessionId -> taskIds`
- `filePath -> taskId`

但当前任务量很小，这样会让实现更复杂。  
本次优先选择简单可靠的单 Map + 低频遍历方案。

### session 过期清理时机

因为采用懒清理，旧 session 的任务与文件不是在“墙上时钟刚好满 6 小时”那一刻立刻删除，而是在下一次触发该 session 访问判断时删除。  
这是性能换简单性的有意取舍，可以接受。

## 验收标准

- `GET /api/tasks` 只返回当前设备 session 的任务
- 非当前 session 的任务不能被读取、下载、取消或删除
- 下载任务支持手动删除
- 手动删除任务时，对应 ZIP 文件一起删除
- ZIP 文件 2 小时过期后，任务记录一起删除
- session 6 小时闲置过期后，该 session 下任务与文件一起删除
- 下载页删除任务后能立即更新
- 整体实现不引入重型存储、常驻后台任务或额外高频刷新
