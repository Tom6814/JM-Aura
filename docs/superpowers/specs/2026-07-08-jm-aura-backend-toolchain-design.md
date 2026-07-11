# JM-Aura Remix：后端“完全复刻（含工具链）”设计稿（Hono-only）

> 目标：在现有 `Hono + TypeScript + sharp` 基础上，将 `JMComic-Crawler-Python-master` 的 **API 能力 + 工具链能力（下载/导出/批量任务/CLI 工作流）** 完整迁移，并保持后端高性能。

## 背景与现状

当前项目已完成：
- 核心接口：搜索、详情、章节、图片代理/解密（`src/server/index.ts` + `src/server/jmClient.ts`）
- 扩展接口：分类/排行、登录、收藏夹、封面代理
- 前端已接入扩展搜索参数

下一阶段要解决的是：Python 项目除“在线浏览”以外的工具链能力（批量/导出/任务化）在 TS/Hono 侧的缺口。

## 目标

- **后端框架约束**：后端只使用 **Hono** 作为 Web 框架（允许引入轻量 npm 依赖，但不引入其它后端框架）。
- **双客户端**：提供 Web 端轻量导出能力 + Node CLI 端完整下载器体验。
- **导出默认 ZIP**：后端任务异步生成 ZIP，客户端下载保存。
- **ZIP 内图片默认保持原格式**（不强制转码）；支持可选 `image_format=webp|jpeg`。
- **高性能**：
  - 流式/分块处理，避免整本/整章大 buffer 常驻内存
  - 并发受控（任务并发、页并发、网络并发）
  - 可取消、可观测、可重试（尽量与 Python 行为对齐）
- **产物临时落盘**：导出的 ZIP 服务端临时保存，TTL=2小时，自动清理。

## 非目标（明确不做或后置）

- 不做“服务器长期存储漫画库”（用户选择的“落到客户端”意味着后端不作为长期资源库）。
- 不做复杂权限系统/多租户后台（仅满足当前工具链需求）。
- 不优先复刻 Python 的全部插件体系；优先复刻核心工作流（搜索/收藏/导出/下载）。

## 关键约束与决策

### 客户端落盘策略
- 选择：**客户端落盘**（Web/CLI 将下载结果写到用户本地）。
- 但为支持“异步任务 + 稳定下载”，服务端允许 **导出 ZIP 临时落盘**（TTL 清理）。

### ZIP 生成位置
- 两种方式都提供：
  - 默认：**后端流式打包 ZIP**（通过任务系统生成 ZIP 文件）
  - 可选：**客户端自打包**（后端提供 manifest + 单页解密图片拉取能力）

### 任务模式
- 默认：异步任务（创建任务 → 轮询进度 → 下载产物）

## 架构总览

### 组件划分（后端）

1. `JMComicClient`（已存在）
   - 负责 API 签名、cookie 管理、数据解密、图片解密、图片获取/转码

2. `JmSessionManager`（新增）
   - 解决“多客户端/多用户”并行时 cookie 混用问题
   - 将 `session_id -> JMComicClient(cookieJar)` 映射保持隔离

3. `TaskManager`（新增）
   - 管理任务：创建、运行、取消、进度、错误
   - 并发控制：全局任务并发 + 任务内下载并发

4. `ZipExporter`（新增）
   - 为任务提供导出能力：album → zip；favorites → zip
   - 默认使用“store（不压缩）”以减少 CPU；可选转码会显著增加 CPU

5. `ExportStore`（新增）
   - 临时文件管理：路径规则、TTL、清理线程/定时器

### 组件划分（客户端）

1. Web（Remix）
   - 轻量：创建导出任务、展示进度、下载 ZIP

2. Node CLI（新增）
   - 完整工具链：登录、搜索、导出本子、导出收藏夹、批量处理、可选“客户端打包”模式

## 会话与登录设计

### 会话标识

客户端可用两种方式传递会话：
- Cookie：`jm_session=<id>`（适合 Web）
- Header：`x-jm-session: <id>`（适合 CLI）

后端规则：
- 若请求未携带 session，则创建匿名 session（只用于非登录接口也可复用域名/cookie 缓存）。
- `POST /api/auth/login` 成功后，将登录态写入该 session 对应的 `JMComicClient.cookieJar`。

### 多会话隔离

`JmSessionManager.getClient(request)`：
- 从 cookie/header 解析 session_id
- 返回对应 `JMComicClient`（不存在则创建）
- 可选：记录 `last_used_at`，便于过期清理

## 任务系统设计

### 任务类型

- `export_album_zip`
- `export_favorites_zip`
- 后续扩展（可选）：`download_album_pages` / `download_chapter_pages` / `export_search_zip`

### 任务状态机

- `queued`：入队等待
- `running`：执行中
- `succeeded`：成功（产物就绪）
- `failed`：失败（包含错误）
- `canceled`：取消
- `expired`：产物过期被清理（任务仍可保留元信息一段时间）

### 进度模型

进度字段建议：
- `total_units`：总工作单元（例如总页数/总章节页数）
- `done_units`
- `current_label`：如“正在导出 第12话 / 00034.webp”
- `bytes_written`（可选）

### 并发控制

两层并发：
- 全局任务并发（例如默认 2）
- 任务内页下载并发（例如默认 6~10，视网络与 CPU）

并发以 `Semaphore` 实现，避免爆内存/爆连接数。

## 导出产物与 TTL

### 文件落盘

- 目录：`./.cache/exports/`
- 文件名：`<task_id>.zip`

### TTL

- 默认 TTL：2 小时
- 清理策略：
  - 周期扫描（例如每 5 分钟）
  - 或在任务查询/下载时做惰性清理

### 下载行为

`GET /api/tasks/:id/download`：
- 仅 `succeeded` 且产物存在时返回文件流
- 若已过期/不存在 → 404 + 明确错误码（`EXPORT_EXPIRED`）

## ZIP 导出细节（高性能）

### 关键策略

- 默认“保持原始格式”：
  - 仍需进行“图片打乱重排”解密，因此会经由 `sharp(raw)` 流程
  - 输出格式选择：根据上游 bytes 的 magic/content-type 推断优先格式（webp/jpeg/png），并尽量“原格式输出”
- 仅当显式传入 `image_format=webp|jpeg` 才进行转码

### ZIP 写入模式

目标：避免将整个 ZIP 常驻内存。

实现方向：
- 使用“store（不压缩）”模式优先
- 支持流式写入：每个 entry 边生成边写文件
- 在写入过程中计算 CRC32（用于 ZIP central directory）

> 注：具体 ZIP 容器实现可先用成熟轻量库快速落地，再替换为自研 store writer；但后续目标是完全可控且性能稳定。

## API 设计（新增/扩展）

### 任务类接口

- `POST /api/tasks/export/album`
  - body: `{ album_id: string, image_format?: "original"|"webp"|"jpeg" }`
- `POST /api/tasks/export/favorites`
  - body: `{ folder_id?: string, order_by?: "mr"|"mv"|"mp"|"tf", image_format?: "original"|"webp"|"jpeg" }`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/cancel`
- `GET /api/tasks/:id/download`

### 客户端自打包（可选能力）

- `GET /api/export/album/:id/manifest`
  - 返回：章节列表、每章 page 列表、每页可下载 URL（解密由后端提供图片代理）
  - CLI/Web 可据此并发拉取并本地写盘/打包

## CLI 复刻（Node）

新增 `cli/`（Node/TS）：

- `jmcli login`
  - 调用 `POST /api/auth/login`，保存 `session_id`（文件或 keychain 简化版）
- `jmcli search`
  - 参数与 Python 类似（keyword/main_tag/order_by/time/page）
- `jmcli export album <id>`
  - 创建任务 → 轮询进度 → 下载 zip 到本地
- `jmcli export favorites`
  - 同上
- `--client-zip` 参数
  - 使用 manifest + 单页拉取，本地打包 zip

## Web 复刻（轻量）

Web 端优先做：
- 创建导出任务（album/favorites）
- 任务列表（最近 N 个）
- 下载按钮

不强制 Web 端实现“客户端自打包”，但保留可能性（File System Access API）。

## 可观测性与错误处理

- Task 失败要返回：
  - 明确 message（尽量对齐 Python 的 msg）
  - 是否可重试（网络错误可重试；鉴权错误提示重新登录）
- 后端日志：
  - 任务启动/结束、耗时、吞吐、失败原因
- 请求级错误：
  - 统一 `{ error: string, code?: string }`

## 测试与验证

最低保障：
- 单元测试：任务状态机、TTL 清理、manifest 生成、参数校验
- 集成测试（可选）：在 mock jmClient 的情况下验证“导出流程写 zip 的 entry 数/命名/CRC”

## 推进顺序（实现计划将拆分）

1. `JmSessionManager`：先解决会话隔离
2. `TaskManager`：先让任务能跑、能取消、能报进度
3. `ExportStore`：临时落盘 + TTL
4. `ZipExporter(export_album_zip)`：从 album/chapters/pages 构建 zip
5. `ZipExporter(export_favorites_zip)`：分页拉 favorites → 批量导出
6. `manifest`：支持客户端自打包
7. `cli/`：复刻 Python CLI 的主干命令
8. Web 端承接（轻量）

## 风险与缓解

- **sharp 转码 CPU 开销**：默认 original，转码作为显式开关；并发受控。
- **多 session 内存膨胀**：session TTL（例如 24h 未使用清理），或限定最大 session 数。
- **任务积压/大导出**：限制全局并发 + 限制单任务页并发；必要时给出“建议使用 CLI + client-zip”路径。

