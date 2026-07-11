# JM-Aura-Remix 封面兜底 / 评论只读 / 登出 / 设备级 Session 设计

## 背景

当前前端封面显示不出来的直接原因不是图片代理失败，而是后端返回的条目数据里 `image` 为空（`null`），导致前端 `CoverArtwork` 只能落到占位图。

用户要求：

- Hono 后端对齐 Python 版“封面兜底”策略（专门的构造方式）
- 顺便补齐：评论（先做只读列表）与登出
- 会话模型升级：每个设备首次访问网页就分配一个专属 session（不管是否登录），闲置 6 小时自动过期；登出时清理登录 cookie，但仍保留设备 session
- 保持 Hono 高性能：兜底逻辑 **0 额外网络请求**，不引入数据库/外部缓存

## 目标

1. **封面可用**：首页 / 搜索 / 发现 / 详情里出现的漫画条目必须稳定拿到可用封面 URL（至少列表缩略图）。
2. **评论可读**：详情页 `comments` tab 能读取评论列表（分页 + 排序）。
3. **可登出**：用户能退出 JM 登录态，回到“未登录但仍有设备会话”的状态。
4. **设备级 Session**：所有 Web 请求都有稳定的设备 session，隔离 JM cookie jar；闲置 6 小时自动清理。

## 非目标

- 不做发评论 / 回复 / 点赞
- 不做账号资料编辑
- 不做多端 session 管理与持久化存储
- 不引入 Express/Fastify/Nest 等框架

## 现状速览（关键落点）

### 1) 封面 URL 的 Python 对齐依据

Python 侧已有明确策略：

- 列表缩略图常用 `size="_3x4"`（见 `JMComic-Crawler-Python-master/src/jmcomic/jm_toolkit.py:get_album_cover_url`）
- URL 规则：`/media/albums/{album_id}{size}.jpg`

### 2) 后端已存在 cover proxy，但映射没用起来

Hono 已有：

- `GET /api/cover/:id?size=&format=`（`src/server/index.ts`）

但数据返回给前端的 `SearchResultItem.image` 仍可能是 `null`，导致前端不走 `image proxy`。

### 3) SessionManager 目前是最小实现

`src/server/session.ts` 明确写了“仅内存 Map，不做 TTL/清理”，且 session id 的 cookie 名当前为 `jm_session`，容易和 JM 的登录态 cookie 概念混淆。

## 设计总览

### 方案选择（已确认）

- **只改 Hono 后端（推荐方案）**：补齐封面兜底到后端映射层；评论只读与登出也放后端实现；前端尽量不改动图片显示方式。

### 核心原则

- **封面兜底只做字符串构造**：严禁为了“拿封面”额外请求 JM 详情页。
- **评论只在 comments tab 请求**：默认详情页 content tab 不预取评论。
- **登出清登录态，不销毁设备 session**：保持设备上下文连续。
- **Session TTL 只做内存清理**：6 小时闲置清理；重新访问再创建新 session。

## 详细设计

## 1) 封面兜底

### 1.1 兜底规则

当映射到前端 schema 时：

- 若上游数据里 `image` 为非空字符串：优先使用上游值
- 否则：构造兜底封面 URL

### 1.2 兜底 URL 规则（对齐 Python）

```
https://{imageDomain}/media/albums/{albumId}{size}.jpg
```

- 列表缩略图：`size="_3x4"`
- 详情页封面：`size=""`（或后续扩展更大尺寸，但本轮先保持空串）

### 1.3 图片域名选择

后端统一通过 `JMComicClient.getImageDomain()` 或配置的 `image_domains` 来选择域名。

建议策略：

- 默认随机或轮询选择（与 Python 随机选域一致）
- 若请求失败（HTTP 非 200），由现有 `fetchImageResponse` 的重试/容错承担，不在这里额外探测

### 1.4 代码落点

- `src/server/jmClient.ts`
  - 新增：`buildAlbumCoverUrl(albumId: string, size?: "" | "_3x4"): string`
- 所有映射 `SearchResultItem` / 详情 `manga` 的地方统一调用：
  - `image ?? buildAlbumCoverUrl(albumId, "_3x4")`

> 注意：这里仅修复“数据结构里 image 为空”，不改前端 `buildPassthroughImageUrl` 的代理策略。

## 2) 评论（只读）

### 2.1 API 设计

新增：

- `GET /api/comments?album_id={id}&page={n}&order={asc|desc}`

返回：

- `success: boolean`
- `comments: Array<{ id, user, content, time, likes? }>`
- `page: number`
- `page_count?: number`

### 2.2 上游对接

评论抓取逻辑应在 `JMComicClient` 内部实现，调用 JM 上游现有接口（具体 endpoint 由现有 Python / 上游 JS 适配结果确定）。

### 2.3 前端消费

`app/routes/manga.$id.tsx` 的 comments tab loader：

- 仅当 `tab=comments` 时请求后端评论接口
- 失败时显示局部错误态 + `重试`

## 3) 登出

### 3.1 API 设计

新增：

- `POST /api/logout`

语义：

- 清理当前设备 session 里的 JM 登录态（cookie jar）
- 返回 `success: true`
- 继续下发设备 session cookie（用于保持匿名 session）

### 3.2 实现原则

- 不要删掉设备 session
- 不要让登出触发全局重建 client（除非更简单：重置当前 session 的 `JMComicClient` 实例）

推荐实现：

- `session.client = new JMComicClient()`（或提供 `reset()` 清理 cookie jar）

## 4) 设备级 Session（6 小时闲置过期）

### 4.1 Cookie 命名

建议将设备 session cookie 与 JM 登录 cookie 解耦，避免混淆：

- 设备 cookie：`aura_session`
- JM 登录 cookie：由 JM 上游决定，仍在 `JMComicClient` cookie jar 内管理

### 4.2 Session id 来源优先级

1. `x-jm-session` header（保留，用于 CLI 显式隔离）
2. `aura_session` cookie（Web）
3. 不存在则创建新 id

### 4.3 TTL 与清理

每个 session 维护：

- `lastAccessAtMs`

规则：

- 每次 `get(request)` 命中 session 时刷新 `lastAccessAtMs`
- 若 `now - lastAccessAtMs > 6h`：
  - 删除该 session
  - 创建新 session（匿名）

实现限制：

- 仅内存 Map
- 允许在 `get()` 内做“顺手清理”（或定时器清理，但先不引入复杂度）

## 测试策略（必须）

### 封面兜底

- 上游 `image` 为空时，映射后的 `SearchResultItem.image` 必须为非空 URL
- 上游 `image` 非空时不覆盖
- `size="_3x4"` 的 URL 必须符合 `/media/albums/{id}_3x4.jpg`

### 登出与 session

- 未登录访问也会下发 `aura_session`
- `POST /api/logout` 后，设备 session 仍保持，但 JM 登录态被清理
- session 闲置超时后重新访问会换新 session id

### 评论只读

- `GET /api/comments` 在缺参/非法参时返回 400（通过 Zod schema 校验）
- 正常请求返回结构符合 `src/shared/schema.ts` 的定义

## 验收标准

1. 首页/搜索/发现/详情封面恢复显示（不再大面积占位）
2. 详情页 comments tab 可读（至少分页/排序）
3. 我的页可登出并回到未登录态
4. 设备 session 存在且 6 小时闲置过期生效
5. 上述改动不引入额外网络瀑布，不拖慢首页与发现页首包
