# Me Favorites/Tasks/Settings Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“我的”页拆分为 `/me`（设置）、`/me/favorites`（收藏）、`/me/tasks`（下载），并保持 Remix 的高性能（稳定 URL 分页、列表页只拉当页、必要数据 `defer`）。

**Architecture:** 采用 Remix flat routes：`me.tsx` 作为设置页，新增 `me.favorites.tsx` 与 `me.tasks.tsx`。收藏页采用桌面两栏/移动单栏布局；作品卡片复用首页 `home-card` 样式。收藏分页大小由设置页写入 cookie，并由后端 `/api/favorites` 通过“多页聚合 + slice”适配 10/20/30/40/60。

**Tech Stack:** Remix 2, React 18, Hono API (`src/server/index.ts`), Zod schema, CSS (现有 `home-card`/`media-grid`).

---

## Files to change

- Modify: `src/server/index.ts`（Favorites API 支持 `page_size`）
- Modify: `app/lib/jm-rpc.server.ts`（`fetchFavorites` 透传 `page_size`）
- Create: `app/lib/me-settings.server.ts`（cookie 读写：收藏分页大小）
- Create: `app/routes/me.favorites.tsx`（收藏页）
- Create: `app/routes/me.tasks.tsx`（下载页）
- Modify: `app/routes/me.tsx`（改为设置页 + 登录/登出，移除 tab 模式）
- Modify: `app/components/profile.tsx`（抽出可复用的 hero 或更新跳转链接）
- Modify: `app/components/chrome.tsx`（如需要调整“我的”入口文字/副标题）
- Test: `app/components/profile.test.tsx`（回归：我的页不再渲染收藏/下载 tab 卡片）

---

### Task 1: Favorites API 支持 `page_size`

**Files:**
- Modify: `src/server/index.ts`
- Test: `src/server/index.test.ts`（新增一条聚合分页测试）

- [ ] **Step 1: 写一个失败测试（page_size=10/40 返回对应数量）**

在 `src/server/index.test.ts` 增加测试：mock `jmClient.requestApi` 返回固定 20 条 list，验证：
- `page_size=10` 时返回 list 长度 10
- `page_size=40` 时会请求 2 页并返回 40（或在测试里验证调用次数 + slice）

- [ ] **Step 2: 实现 query schema 新增可选 `page_size`**

在 favoritesQuerySchema 增加 `page_size`（限定 10/20/30/40/60；默认保持 20）。

- [ ] **Step 3: 实现“多页聚合 + slice”**

根据 `page` 与 `page_size` 计算 upstream 页范围（upstream 固定 20）：
- `start = floor(offset/20)+1`
- `end = floor((offset+page_size-1)/20)+1`
并并行请求，合并后 slice。

- [ ] **Step 4: 更新 `page_count` 计算为 `ceil(total / page_size)`**

- [ ] **Step 5: 跑测试**

Run: `node --import tsx --test src/server/index.test.ts`

---

### Task 2: Remix 侧透传 page_size + settings cookie

**Files:**
- Modify: `app/lib/jm-rpc.server.ts`
- Create: `app/lib/me-settings.server.ts`

- [ ] **Step 1: 新增 cookie 读写工具**

`me-settings.server.ts`：
- `getFavoritesPageSize(request): number`
- `commitFavoritesPageSize(size): HeadersInit`（或返回 `Set-Cookie`）
默认 20，仅允许 10/20/30/40/60。

- [ ] **Step 2: `fetchFavorites` 增加参数 `page_size` 并透传到 `/api/favorites`**

URL 增加 `page_size` query。

- [ ] **Step 3: 跑 typecheck**

Run: `npm run -s typecheck`

---

### Task 3: `/me` 设置页（只放“收藏每页条数”）

**Files:**
- Modify: `app/routes/me.tsx`

- [ ] **Step 1: loader 读取当前 page_size（cookie）并渲染设置卡**

设置项用 `<Form method=\"post\">` 提交 `intent=set_favorites_page_size` + `page_size`。

- [ ] **Step 2: action 支持 `set_favorites_page_size` 并写 cookie**

成功后 `redirect(\"/me\")`（或 `return json` + `Set-Cookie` 均可，优先 redirect 简化一致性）。

- [ ] **Step 3: 保留登录/登出 action（现有 intent：login/logout）**

`login` 成功后可以 `redirect(redirectTo)` 以适配新页面结构（`/me/favorites`、`/me/tasks`）。

- [ ] **Step 4: 手动验证**

打开 `/me` 修改分页大小后，进入 `/me/favorites` 确认生效。

---

### Task 4: `/me/favorites` 收藏页（桌面两栏/移动单栏 + 首页卡片样式）

**Files:**
- Create: `app/routes/me.favorites.tsx`
- Modify: `app/components/home.tsx`（若需要抽出复用卡片组件，否则复制一份同样结构到新组件）

- [ ] **Step 1: loader 读取 folder/page + page_size（cookie）并调用 `fetchFavorites`**

支持 query：
- `folder`（默认 0）
- `page`（默认 1）

返回 `defer({ favorites: ... })`。

- [ ] **Step 2: UI**

桌面：
- 左侧：folder 列表（点击更新 URL）
- 右侧：作品 grid（复用 `home-card` + `CoverArtwork`），底部分页组件

手机：
- 顶部 folder chips
- 下方同样 grid + 分页

- [ ] **Step 3: 兼容未登录**

未登录时显示提示 + 去 `/me` 登录按钮，不拉 favorites。

- [ ] **Step 4: 手动验证**

进入 `/me/favorites`，切 folder、翻页、点击作品进入详情。

---

### Task 5: `/me/tasks` 下载页（分页 + 简洁布局）

**Files:**
- Create: `app/routes/me.tasks.tsx`

- [ ] **Step 1: loader 调用 `fetchTaskList`，前端做轻量分页（slice）**

query：`page`（默认 1），每页固定 20（暂不做设置项）。

- [ ] **Step 2: UI**

列表展示：任务名、状态、时间、进度；支持“创建收藏夹导出任务”入口（可选）。

- [ ] **Step 3: 手动验证**

创建导出任务后能在该页看到。

---

## Self-review checklist

- [ ] `/me` 不再依赖 `?tab=`，收藏/下载都用独立路由
- [ ] 收藏卡片样式与首页一致（复用 `home-card`/`CoverArtwork`）
- [ ] 收藏分页大小从设置写 cookie，并对 `/api/favorites?page_size=` 生效
- [ ] loader 只拉当页数据（收藏最多聚合 3 页 upstream）
- [ ] `npm run -s typecheck` 通过；相关测试通过

