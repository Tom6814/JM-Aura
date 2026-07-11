# JM-Aura Remix：JM 用户资料 API 与“我的”页展示设计稿

> 目标：参考 Python 原版资料能力，在当前 `Hono + Remix` 架构中新增高性能的用户资料读取链路，支持头像、等级、称号、签名等信息，并在“我的”页中展示。

## 背景

当前项目已经具备：
- 设备级 session 与 JM 登录态隔离
- `POST /api/auth/login`、`POST /api/logout`
- “我的”页登录、收藏夹、下载任务展示

当前缺口是：登录后虽然能同步收藏夹，但“我的”页仍然只有占位头像和固定文案，缺少 Python 原版里常见的用户资料字段，例如头像、昵称、等级、称号、签名。

## 目标

- 新增独立的 `GET /api/profile`，专门返回当前 JM 会话对应的用户资料。
- 不把资料抓取塞进登录接口，避免扩大 `login` 的职责和延迟。
- “我的”页在已登录时并行读取 `profile + favorites + tasks`。
- 资料接口尽量对齐 Python 原版的字段来源，但在 Hono 侧做稳定、轻量的映射。
- 保持 Hono 高性能：不引入重型中间层，不增加无谓串行请求，不因资料失败拖垮整页。

## 非目标

- 不实现资料编辑、头像上传、签到等写操作。
- 不为了资料接口引入新的后端框架或浏览器自动化链路。
- 不要求前端完全复刻 Python 原版的视觉样式，只补齐信息能力与合理展示。

## 方案选择

本次采用：

- `推荐方案：独立 /api/profile + 我的页按需并行读取`

不采用：

- 将 profile 强塞进 `POST /api/auth/login`
  - 会让登录接口职责混乱，后续单独刷新资料不方便。
- 将 profile 隐式塞进 `GET /api/favorites`
  - 会把“收藏夹同步”和“资料同步”耦合在一起，不利于失败隔离。

## API 设计

### 新增接口

- `GET /api/profile`

语义：
- 读取当前设备 session 绑定的 `JMComicClient`
- 访问 JM 上游资料来源
- 返回映射后的稳定资料结构

### 响应结构

```ts
{
  isLoggedIn: boolean;
  profile: {
    username: string | null;
    nickname: string | null;
    avatar: string | null;
    level: string | null;
    title: string | null;
    badge: string | null;
    signature: string | null;
  } | null;
  authMessage: string;
  error: string | null;
}
```

说明：
- `isLoggedIn` 表示当前 session 是否能读取到有效资料。
- `profile` 允许为 `null`，避免未登录或解析失败时产生不稳定 shape。
- `level`、`title`、`badge` 分开保留，避免前端后续想拆分排版时只能反向解析字符串。
- 各资料字段允许为 `null`，部分字段缺失不应导致整包失败。

## 数据来源与映射

### 来源原则

- 优先参考 Python 原版已验证过的 profile 数据来源和字段命名。
- Hono 不直接暴露上游原始结构给前端，而是做一次稳定映射。
- 若上游结构中存在多个候选键，按优先级读取并归一化。

### 字段映射原则

- `username`
  - 取用户名类字段
- `nickname`
  - 取昵称/展示名类字段
- `avatar`
  - 取头像 URL，若是相对路径则补成可直接访问的绝对 URL
- `level`
  - 取等级文本或等级标识，转成字符串
- `title`
  - 取用户称号/头衔
- `badge`
  - 取徽章、额外称号、装饰称谓等不稳定但可能有价值的字段
- `signature`
  - 取个性签名/简介

### 解析容错

- 如果资料接口整体返回 401/未登录语义，则：
  - `isLoggedIn = false`
  - `profile = null`
- 如果只是部分字段取不到：
  - `isLoggedIn = true`
  - 缺失字段填 `null`
- 如果上游返回结构变化导致解析失败：
  - 返回 `error`
  - 不抛出未处理异常给前端

## 后端实现约束

### 性能

- 不在 `login` 成功后追加 profile 请求。
- `GET /api/profile` 只在“我的”页或显式调用时触发。
- 继续复用现有 session 内 `JMComicClient`，不额外复制 cookie jar。
- 不在 profile 链路中引入额外图片代理处理；头像先返回原始/归一化 URL，由前端直接展示。

### 错误隔离

- `profile` 请求失败不能影响：
  - `favorites`
  - `tasks`
  - 现有登录/登出链路

### 代码边界

- `src/server/jmClient.ts`
  - 新增轻量 profile 抓取方法或解析 helper
- `src/server/index.ts`
  - 新增 `GET /api/profile`
- `src/shared/schema.ts`
  - 新增 profile 响应 schema
- `app/lib/jm-rpc.server.ts`
  - 新增 `fetchProfile()`

## “我的”页展示设计

### Loader 行为

`/me` 在已有 session 时并行读取：

- `favoritesState`
- `profileState`
- `tasksState`

约束：
- `profileState` 单独失败时，不影响其余两个 promise 的成功展示。

### 展示优先级

- 头像：
  - 优先真实头像
  - 无头像则回退到当前字母头像
- 名称：
  - `nickname > username > JM 用户`
- 副标题：
  - 优先显示 `等级 + 称号`
  - 若只存在其中一个，则单独显示
  - 都缺失则回退到“已连接 · 漫读者”
- 签名：
  - 有值才显示
  - 无值不占位

### 错误与降级

- 未登录：
  - 保持现有登录表单体验
- 已登录但 profile 失败：
  - 头像区退回占位头像
  - favorites 与 tasks 正常展示
  - 在资料区域显示轻量错误与重试入口

## 测试设计

### 后端测试

- `GET /api/profile` 未登录时返回未登录结构
- 上游资料成功时，正确映射头像、昵称、等级、称号、签名
- 上游部分字段缺失时返回 `null` 而不是 500
- 上游异常时返回可读错误，不破坏其它接口

### 前端测试

- “我的”页已登录时显示真实头像或昵称信息
- 名称优先级正确：`nickname > username > JM 用户`
- 等级/称号存在时可展示，不存在时不占空位
- profile 失败时 favorites/tasks 仍正常渲染

## 实施顺序

1. 新增 shared schema 与后端 profile 映射测试
2. 实现 `GET /api/profile`
3. 新增 Remix RPC `fetchProfile()`
4. 更新 `/me` loader 的并行读取结构
5. 更新“我的”页头像与资料展示
6. 补前端降级与重试测试

## 风险与应对

### 风险 1：Python 原版字段来源分散或命名不稳定

应对：
- 在 Hono 侧集中写优先级映射函数
- 保证最终对前端输出的 shape 稳定

### 风险 2：头像 URL 不可直接访问

应对：
- 先优先复用上游可直接访问地址
- 若后续发现需要代理，再单独评估是否引入头像 passthrough，而不是在本次设计里提前复杂化

### 风险 3：资料请求增加“我的”页首屏延迟

应对：
- 继续使用并行读取
- profile 单独失败不阻塞 favorites/tasks
- 前端资料区允许局部 loading / retry

