# MD3 Expressive Remix Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Remix 前端重构为一套以“继续阅读优先”为核心、完整适配 Hono 后端、具备深浅双主题、Safari 与全尺寸屏幕友好、且以体验优先的 MD3 Expressive 漫画阅读应用。

**Architecture:** 前端重构分为四层：设计系统与主题基础、数据适配与 loader、页面编排、阅读体验层。页面数据优先走 `GET /api/home`、`POST /api/categories`、`/api/tasks/*` 等已有后端接口；视觉层以 CSS variables + 分层样式文件为核心，尽量避免高成本运行时动画与复杂状态。布局与阅读器都从一开始考虑 Safari、`safe-area-inset-*`、大屏最大宽度控制和低占用滚动稳定性。

**Tech Stack:** Remix, React, TypeScript, Hono typed client (`hc`), Zod, CSS variables, node:test, tsx.

---

## 0. 文件结构

### 需要新增的文件

- `app/styles/tokens.css`：深浅双主题 token、safe area、动态视口、全局色彩/排版/shape 变量
- `app/styles/shell.css`：app shell、导航、响应式容器、Safari 兼容布局
- `app/styles/components.css`：按钮、卡片、chip、列表行、状态块、搜索条等通用组件样式
- `app/styles/reader.css`：阅读器专属样式、浮层、沉浸层、控件与 safe area
- `app/lib/theme.server.ts`：主题 cookie 解析/写入 helper
- `app/lib/reading-state.ts`：继续阅读状态、阅读偏好、最近阅读的纯函数与浏览器存储策略
- `app/lib/reading-state.test.ts`：继续阅读状态与偏好 helper 单测
- `app/lib/home.server.ts`：首页 loader 适配，消费 `GET /api/home`
- `app/lib/home.server.test.ts`：首页 adapter 单测
- `app/lib/discover-query.ts`：发现页 query 解析/构造 helper
- `app/lib/discover-query.test.ts`：发现页 query helper 单测
- `app/lib/tasks.server.ts`：任务列表、任务状态、下载状态等适配
- `app/lib/tasks.server.test.ts`：任务适配 helper 单测
- `app/components/chrome.tsx`：全局 app shell、顶部 app bar、底部导航、主题切换入口
- `app/components/primitives.tsx`：通用 Expressive 组件（按钮、section header、hero card、content rail、status panel）
- `app/components/media.tsx`：封面、背景图、图片占位与渐进显示
- `app/components/home.tsx`：首页专用块（继续阅读主卡、排行切换、最新更新带）
- `app/components/discover.tsx`：发现页分类轨道、子分类轨道、结果网格
- `app/components/profile.tsx`：我的页登录卡、收藏夹、任务列表
- `app/routes/discover.tsx`：发现页
- `app/routes/me.tsx`：我的页

### 需要重点修改的文件

- `app/root.tsx`：切换为多样式文件引入、主题属性注入、ErrorBoundary 更新
- `app/styles/app.css`：逐步瘦身，最终只保留聚合 import 或少量兼容层
- `app/components/ui.tsx`：拆分后缩减或作为兼容导出层
- `app/lib/jm-rpc.server.ts`：新增 home/tasks/category-sub_category/front-end adapter 能力
- `app/routes/_index.tsx`：首页重构为 `GET /api/home` 驱动的阅读中枢
- `app/routes/search.tsx`：重做布局与筛选层级，保持 URL 驱动
- `app/routes/manga.$id.tsx`：重构详情页、收藏/导出入口与章节编排
- `app/routes/chapter.$id.tsx`：重构沉浸式阅读器与阅读偏好

### 测试与验证入口

- `app/lib/reading-state.test.ts`
- `app/lib/home.server.test.ts`
- `app/lib/discover-query.test.ts`
- `app/lib/tasks.server.test.ts`
- `app/lib/search-query.test.ts`（现有，必要时同步更新）

---

## Task 1: 建立双主题与 Safari 友好的设计系统地基

**Files:**
- Create: `app/styles/tokens.css`
- Create: `app/styles/shell.css`
- Create: `app/styles/components.css`
- Create: `app/styles/reader.css`
- Create: `app/lib/theme.server.ts`
- Modify: `app/root.tsx`
- Modify: `app/styles/app.css`
- Test: `app/lib/reading-state.test.ts`

- [ ] **Step 1: 写主题/偏好 helper 的失败测试**

创建 `app/lib/reading-state.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeReadingState,
  normalizeThemeName,
  normalizeReaderWidth,
} from "./reading-state";

test("normalizeThemeName only accepts dark/light", () => {
  assert.equal(normalizeThemeName("dark"), "dark");
  assert.equal(normalizeThemeName("light"), "light");
  assert.equal(normalizeThemeName("system"), "dark");
});

test("normalizeReaderWidth clamps width for large screens", () => {
  assert.equal(normalizeReaderWidth(540), 540);
  assert.equal(normalizeReaderWidth(1600), 1040);
  assert.equal(normalizeReaderWidth(220), 320);
});

test("mergeReadingState keeps latest progress per manga", () => {
  assert.deepEqual(
    mergeReadingState(
      { mangaId: "413446", chapterId: "147643", progress: 0.45 },
      { mangaId: "413446", chapterId: "147700", progress: 0.1 },
    ),
    { mangaId: "413446", chapterId: "147700", progress: 0.1 },
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/reading-state.test.ts`  
Expected: FAIL with `Cannot find module './reading-state'`

- [ ] **Step 3: 实现最小 helper 与主题服务**

创建 `app/lib/reading-state.ts`：

```ts
export type ThemeName = "dark" | "light";

export type ReadingState = {
  mangaId: string;
  chapterId: string;
  progress: number;
};

export function normalizeThemeName(input: string | null | undefined): ThemeName {
  return input === "light" ? "light" : "dark";
}

export function normalizeReaderWidth(input: number): number {
  const numeric = Number.isFinite(input) ? input : 760;
  return Math.max(320, Math.min(1040, Math.round(numeric)));
}

export function mergeReadingState(_prev: ReadingState, next: ReadingState): ReadingState {
  return next;
}
```

创建 `app/lib/theme.server.ts`：

```ts
import { createCookie } from "@remix-run/node";
import { normalizeThemeName } from "./reading-state";

export const themeCookie = createCookie("jm_theme", {
  path: "/",
  sameSite: "lax",
  httpOnly: false,
  maxAge: 60 * 60 * 24 * 365,
});

export async function readThemeFromRequest(request: Request) {
  const cookieHeader = request.headers.get("Cookie");
  const raw = await themeCookie.parse(cookieHeader);
  return normalizeThemeName(typeof raw === "string" ? raw : null);
}
```

为样式建立第一版骨架：

`app/styles/tokens.css`
```css
:root {
  color-scheme: dark;
  --app-safe-top: env(safe-area-inset-top, 0px);
  --app-safe-bottom: env(safe-area-inset-bottom, 0px);
  --app-vh: 100vh;
  --app-reader-max-width: 1040px;
  --app-content-max-width: 1360px;
}

html[data-theme="dark"] {
  color-scheme: dark;
  --md-ref-ink: #181415;
  --md-ref-paper: #f8f3ef;
  --md-sys-color-background: #161214;
  --md-sys-color-surface: #161214;
  --md-sys-color-primary: #ffb7c6;
}

html[data-theme="light"] {
  color-scheme: light;
  --md-ref-ink: #221d1e;
  --md-ref-paper: #f8f4ee;
  --md-sys-color-background: #f8f4ee;
  --md-sys-color-surface: #fffaf6;
  --md-sys-color-primary: #8f495d;
}
```

`app/root.tsx` 中先接入：

```tsx
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: tokensStylesHref },
  { rel: "stylesheet", href: shellStylesHref },
  { rel: "stylesheet", href: componentsStylesHref },
  { rel: "stylesheet", href: readerStylesHref },
];
```

以及 loader / html：

```tsx
export async function loader({ request }: LoaderFunctionArgs) {
  return json({ theme: await readThemeFromRequest(request) });
}

<html lang="zh-CN" data-theme={data.theme}>
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/reading-state.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/root.tsx app/styles/app.css app/styles/tokens.css app/styles/shell.css app/styles/components.css app/styles/reader.css app/lib/theme.server.ts app/lib/reading-state.ts app/lib/reading-state.test.ts
git commit -m "feat: add md3 expressive theme foundation"
```

如果当前目录仍未 `git init`，先跳过 commit，只保留上述 `git add/git commit` 作为之后执行命令。

---

## Task 2: 扩展前端 RPC 适配层，接入首页聚合、子分类与任务接口

**Files:**
- Create: `app/lib/home.server.ts`
- Create: `app/lib/home.server.test.ts`
- Create: `app/lib/tasks.server.ts`
- Create: `app/lib/tasks.server.test.ts`
- Modify: `app/lib/jm-rpc.server.ts`
- Test: `app/lib/home.server.test.ts`

- [ ] **Step 1: 写首页适配失败测试**

创建 `app/lib/home.server.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { mapHomeFeedToSections } from "./home.server";

test("mapHomeFeedToSections promotes continue-reading and ranking rails", () => {
  const result = mapHomeFeedToSections({
    latest: {
      content: [{ id: "100", name: "最新作品", tags: [], author: null, description: null, image: null }],
      total: 1,
      page_size: 80,
      page_count: 1,
    },
    rankings: {
      today: { content: [{ id: "200", name: "今日榜", tags: [], author: null, description: null, image: null }], total: 1, page_size: 80, page_count: 1 },
      week: { content: [], total: 0, page_size: 80, page_count: 0 },
      month: { content: [], total: 0, page_size: 80, page_count: 0 },
    },
  });

  assert.equal(result.latest[0]?.id, "100");
  assert.equal(result.rankings.today[0]?.id, "200");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/home.server.test.ts`  
Expected: FAIL with `Cannot find module './home.server'`

- [ ] **Step 3: 在 RPC 层补全 home/categories/tasks 适配**

修改 `app/lib/jm-rpc.server.ts`，新增类型与函数：

```ts
import {
  homeFeedSchema,
  categoryResultSchema,
  favoritesResultSchema,
  type HomeFeed,
} from "../../src/shared/schema";

export interface FetchCategoriesInput {
  page?: number;
  category?: Category;
  sub_category?: string;
  order_by?: OrderBy;
  time?: TimeRange;
}

export async function fetchHomeFeed(request: Request, category: Category = ""): Promise<HomeFeed> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/home?category=${encodeURIComponent(category)}`);
  return parseRpcResponse(response, homeFeedSchema, "获取首页聚合数据失败");
}

export async function fetchCategories(request: Request, input: FetchCategoriesInput = {}): Promise<CategoryResult> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      page: input.page ?? 1,
      category: input.category ?? "",
      sub_category: input.sub_category,
      order_by: input.order_by ?? "mv",
      time: input.time ?? "a",
    }),
  });
  return parseRpcResponse(response, categoryResultSchema, "获取分类列表失败");
}

export async function fetchTaskList(request: Request) {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/tasks`);
  return parseRpcResponse(response, z.array(taskSchema), "获取任务列表失败");
}
```

创建 `app/lib/home.server.ts`：

```ts
import type { HomeFeed, SearchResultItem } from "../../src/shared/schema";

export function mapHomeFeedToSections(feed: HomeFeed): {
  latest: SearchResultItem[];
  rankings: {
    today: SearchResultItem[];
    week: SearchResultItem[];
    month: SearchResultItem[];
  };
} {
  return {
    latest: feed.latest.content,
    rankings: {
      today: feed.rankings.today.content,
      week: feed.rankings.week.content,
      month: feed.rankings.month.content,
    },
  };
}
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/home.server.test.ts app/lib/tasks.server.test.ts && npm run typecheck`  
Expected: PASS（`tasks.server.test.ts` 若尚未创建，则先补最小测试）

- [ ] **Step 5: Commit**

```bash
git add app/lib/jm-rpc.server.ts app/lib/home.server.ts app/lib/home.server.test.ts app/lib/tasks.server.ts app/lib/tasks.server.test.ts
git commit -m "feat: add frontend adapters for home categories and tasks"
```

---

## Task 3: 重构全局 shell、导航与主题切换

**Files:**
- Create: `app/components/chrome.tsx`
- Create: `app/components/primitives.tsx`
- Create: `app/components/media.tsx`
- Modify: `app/components/ui.tsx`
- Modify: `app/root.tsx`
- Test: `app/lib/reading-state.test.ts`

- [ ] **Step 1: 扩展失败测试，锁定主题合法值与阅读宽度规则**

在 `app/lib/reading-state.test.ts` 追加：

```ts
test("normalizeThemeName falls back to dark for unsupported values", () => {
  assert.equal(normalizeThemeName("sepia"), "dark");
});
```

- [ ] **Step 2: 跑测试确认仍有一个失败点**

Run: `node --import tsx --test app/lib/reading-state.test.ts`  
Expected: FAIL（如果尚未覆盖该分支）

- [ ] **Step 3: 用新 chrome 组件替换旧 `AppChrome`**

创建 `app/components/chrome.tsx`：

```tsx
import type { ReactNode } from "react";
import { Form, Link, useLocation } from "@remix-run/react";

export function AppChrome(props: {
  title?: string;
  primarySlot?: ReactNode;
  children: ReactNode;
  immersive?: boolean;
}) {
  const location = useLocation();
  const pathname = location.pathname;

  if (props.immersive) return <>{props.children}</>;

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <Link to="/" className="app-wordmark" prefetch="intent">
          <span className="app-wordmark__mono">JM</span>
          <span className="app-wordmark__title">{props.title ?? "Aura"}</span>
        </Link>
        <Form action="/search" className="app-topbar__search">
          <input name="keyword" type="search" placeholder="搜索作品、作者、车号…" className="md-search-input" />
        </Form>
        <ThemeToggleButton />
      </header>

      <main className="app-main">{props.children}</main>

      <nav className="app-bottom-nav">
        <NavLinkItem to="/" label="首页" icon="home" active={pathname === "/"} />
        <NavLinkItem to="/search" label="搜索" icon="search" active={pathname.startsWith("/search")} />
        <NavLinkItem to="/discover" label="发现" icon="explore" active={pathname.startsWith("/discover")} />
        <NavLinkItem to="/me" label="我的" icon="person" active={pathname.startsWith("/me")} />
      </nav>
    </div>
  );
}
```

在 `app/components/ui.tsx` 中先做兼容导出：

```tsx
export { AppChrome } from "./chrome";
export { CoverArtwork } from "./media";
```

在 `app/styles/shell.css` 中加入 Safari/safe-area 关键规则：

```css
.app-shell {
  min-height: 100vh;
  min-height: 100dvh;
  padding-top: calc(72px + var(--app-safe-top));
  padding-bottom: calc(86px + var(--app-safe-bottom));
}

.app-topbar {
  position: fixed;
  top: 0;
  inset-inline: 0;
  padding-top: var(--app-safe-top);
  background: color-mix(in srgb, var(--md-sys-color-surface) 82%, transparent);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
}

@supports not ((backdrop-filter: blur(18px)) or (-webkit-backdrop-filter: blur(18px))) {
  .app-topbar {
    background: var(--md-sys-color-surface-container);
  }
}
```

- [ ] **Step 4: 跑测试与类型检查**

Run: `node --import tsx --test app/lib/reading-state.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/chrome.tsx app/components/primitives.tsx app/components/media.tsx app/components/ui.tsx app/root.tsx app/styles/shell.css app/styles/components.css app/lib/reading-state.ts app/lib/reading-state.test.ts
git commit -m "feat: rebuild app shell with expressive navigation"
```

---

## Task 4: 重构首页为“继续阅读优先”的阅读中枢

**Files:**
- Create: `app/components/home.tsx`
- Modify: `app/routes/_index.tsx`
- Modify: `app/lib/home.server.ts`
- Test: `app/lib/home.server.test.ts`

- [ ] **Step 1: 扩展首页映射失败测试**

在 `app/lib/home.server.test.ts` 追加：

```ts
test("mapHomeFeedToSections keeps empty ranking rails stable", () => {
  const result = mapHomeFeedToSections({
    latest: { content: [], total: 0, page_size: 80, page_count: 0 },
    rankings: {
      today: { content: [], total: 0, page_size: 80, page_count: 0 },
      week: { content: [], total: 0, page_size: 80, page_count: 0 },
      month: { content: [], total: 0, page_size: 80, page_count: 0 },
    },
  });

  assert.deepEqual(result.rankings.today, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/home.server.test.ts`  
Expected: FAIL if helper or types are not updated

- [ ] **Step 3: 用 `GET /api/home` 重写首页 loader 与 UI**

修改 `app/routes/_index.tsx`：

```tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const feed = await fetchHomeFeed(request);
  return json({
    sections: mapHomeFeedToSections(feed),
    theme: await readThemeFromRequest(request),
  });
}
```

创建 `app/components/home.tsx`：

```tsx
export function ContinueReadingHero(props: {
  mangaId: string;
  title: string;
  chapterLabel: string;
  progress: number;
  to: string;
}) {
  return (
    <section className="home-hero">
      <div className="home-hero__content">
        <span className="home-hero__eyebrow">继续阅读</span>
        <h1>{props.title}</h1>
        <p>{props.chapterLabel}</p>
        <div className="home-hero__progress">
          <div style={{ width: `${Math.round(props.progress * 100)}%` }} />
        </div>
        <Link to={props.to} className="md-button md-button--primary">继续阅读</Link>
      </div>
    </section>
  );
}
```

首页布局目标：

- 第一屏：继续阅读主卡 + 快速搜索 + 今日发现
- 下方：继续阅读历史 / 最新更新 / 今日-本周-本月排行切换 / 收藏与任务概览

- [ ] **Step 4: 跑测试与类型检查**

Run: `node --import tsx --test app/lib/home.server.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/_index.tsx app/components/home.tsx app/lib/home.server.ts app/lib/home.server.test.ts
git commit -m "feat: rebuild home as reading hub"
```

---

## Task 5: 重构搜索页与新增发现页

**Files:**
- Create: `app/routes/discover.tsx`
- Create: `app/components/discover.tsx`
- Create: `app/lib/discover-query.ts`
- Create: `app/lib/discover-query.test.ts`
- Modify: `app/routes/search.tsx`
- Modify: `app/lib/jm-rpc.server.ts`
- Test: `app/lib/discover-query.test.ts`

- [ ] **Step 1: 写发现页 query helper 失败测试**

创建 `app/lib/discover-query.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { parseDiscoverParams } from "./discover-query";

test("parseDiscoverParams normalizes category sub_category and ranking mode", () => {
  const params = new URLSearchParams({
    category: "doujin",
    sub_category: "CG",
    order_by: "mv",
    time: "a",
  });

  assert.deepEqual(parseDiscoverParams(params), {
    category: "doujin",
    sub_category: "CG",
    order_by: "mv",
    time: "a",
    page: 1,
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/discover-query.test.ts`  
Expected: FAIL with `Cannot find module './discover-query'`

- [ ] **Step 3: 实现发现页 query helper 与页面**

创建 `app/lib/discover-query.ts`：

```ts
import { CATEGORY_VALUES, ORDER_BY_VALUES, TIME_VALUES } from "../../src/shared/schema";

export function parseDiscoverParams(params: URLSearchParams) {
  const category = CATEGORY_VALUES.includes((params.get("category") ?? "") as any) ? (params.get("category") ?? "") : "";
  const order_by = ORDER_BY_VALUES.includes((params.get("order_by") ?? "mv") as any) ? (params.get("order_by") ?? "mv") : "mv";
  const time = TIME_VALUES.includes((params.get("time") ?? "a") as any) ? (params.get("time") ?? "a") : "a";
  const sub_category = params.get("sub_category")?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  return { category, sub_category, order_by, time, page };
}
```

创建 `app/routes/discover.tsx` loader：

```tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const query = parseDiscoverParams(url.searchParams);
  const result = await fetchCategories(request, query);
  return json({ query, result, apiOrigin: getApiOrigin(request) });
}
```

同时重构 `app/routes/search.tsx`：

- 筛选区从“表单块”改成“上下文 + 可折叠过滤器 + 高密度结果”
- 保持 URL 参数驱动
- 移动端筛选抽屉 / 桌面端行内筛选

- [ ] **Step 4: 跑测试与类型检查**

Run: `node --import tsx --test app/lib/discover-query.test.ts app/lib/search-query.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/discover.tsx app/components/discover.tsx app/lib/discover-query.ts app/lib/discover-query.test.ts app/routes/search.tsx app/lib/jm-rpc.server.ts
git commit -m "feat: rebuild search and add discover experience"
```

---

## Task 6: 重构详情页，打通收藏与导出入口

**Files:**
- Modify: `app/routes/manga.$id.tsx`
- Modify: `app/lib/jm-rpc.server.ts`
- Create: `app/lib/tasks.server.ts`
- Test: `app/lib/tasks.server.test.ts`

- [ ] **Step 1: 写任务状态映射失败测试**

创建 `app/lib/tasks.server.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { mapTaskStatusTone } from "./tasks.server";

test("mapTaskStatusTone maps task states to stable UI tones", () => {
  assert.equal(mapTaskStatusTone("queued"), "neutral");
  assert.equal(mapTaskStatusTone("running"), "accent");
  assert.equal(mapTaskStatusTone("succeeded"), "success");
  assert.equal(mapTaskStatusTone("failed"), "error");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/tasks.server.test.ts`  
Expected: FAIL with `Cannot find module './tasks.server'`

- [ ] **Step 3: 实现任务 UI helper，并重构详情页操作区**

创建 `app/lib/tasks.server.ts`：

```ts
export function mapTaskStatusTone(status: string) {
  switch (status) {
    case "running":
      return "accent";
    case "succeeded":
      return "success";
    case "failed":
    case "canceled":
      return "error";
    default:
      return "neutral";
  }
}
```

重构 `app/routes/manga.$id.tsx`：

- 顶部 Hero 改为受控大封面 + 柔和背景，不再依赖高强 blur 才成立
- 操作区真实接入：
  - “继续阅读”
  - “从第一话开始”
  - “收藏”
  - “导出” → 跳转我的页任务区或触发导出入口
- 章节列表重构为更稳的章节行与当前阅读位置提示

详情页动作区骨架：

```tsx
<div className="manga-actions">
  <Link to={resumeTo} className="md-button md-button--primary">继续阅读</Link>
  <Link to={startTo} className="md-button md-button--tonal">从第一话开始</Link>
  <Form method="post">
    <button type="submit" className="md-button md-button--outlined">收藏</button>
  </Form>
  <Link to="/me?tab=tasks" className="md-button md-button--surface">导出</Link>
</div>
```

- [ ] **Step 4: 跑测试与类型检查**

Run: `node --import tsx --test app/lib/tasks.server.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/manga.$id.tsx app/lib/tasks.server.ts app/lib/tasks.server.test.ts app/lib/jm-rpc.server.ts
git commit -m "feat: rebuild manga detail with real actions"
```

---

## Task 7: 重构阅读器，优先夜读舒适、Safari 稳定与低占用

**Files:**
- Modify: `app/routes/chapter.$id.tsx`
- Modify: `app/styles/reader.css`
- Modify: `app/lib/reading-state.ts`
- Test: `app/lib/reading-state.test.ts`

- [ ] **Step 1: 为阅读器偏好补失败测试**

在 `app/lib/reading-state.test.ts` 追加：

```ts
test("normalizeReaderWidth keeps readable bounds for immersive mode", () => {
  assert.equal(normalizeReaderWidth(1280), 1040);
  assert.equal(normalizeReaderWidth(760), 760);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/reading-state.test.ts`  
Expected: FAIL if normalization logic not aligned

- [ ] **Step 3: 重构阅读器页面与样式**

目标：

- 受控最大阅读宽度
- 顶部/底部浮层与 `safe-area` 对齐
- 控件默认隐藏，交互时出现
- 优先保证 Safari 滚动稳定与图片流渲染轻量

`app/routes/chapter.$id.tsx` 中关键结构：

```tsx
<AppChrome immersive>
  <div className="reader-shell" data-theme={theme}>
    <header className={showChrome ? "reader-topbar" : "reader-topbar reader-topbar--hidden"}>
      <Link to={backTo}>返回</Link>
      <div>{chapter.indextitle}</div>
    </header>

    <main className="reader-stage">
      {chapter.image_list.map((image) => (
        <img
          key={image.index}
          src={buildImageProxyUrl(apiOrigin, image, theme === "light" ? "jpeg" : "webp")}
          loading="lazy"
          decoding="async"
          className="reader-image"
          alt=""
        />
      ))}
    </main>

    <footer className={showChrome ? "reader-bottombar" : "reader-bottombar reader-bottombar--hidden"}>
      <button>上一章</button>
      <button>下一章</button>
    </footer>
  </div>
</AppChrome>
```

`app/styles/reader.css` 关键兼容规则：

```css
.reader-shell {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--reader-bg, #090707);
}

.reader-stage {
  width: min(100%, var(--app-reader-max-width));
  margin-inline: auto;
}

.reader-bottombar {
  padding-bottom: calc(14px + var(--app-safe-bottom));
}
```

- [ ] **Step 4: 跑测试与类型检查**

Run: `node --import tsx --test app/lib/reading-state.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/chapter.$id.tsx app/styles/reader.css app/lib/reading-state.ts app/lib/reading-state.test.ts
git commit -m "feat: rebuild immersive reader for comfort and stability"
```

---

## Task 8: 新增“我的”页，承接登录、收藏、导出任务

**Files:**
- Create: `app/routes/me.tsx`
- Create: `app/components/profile.tsx`
- Modify: `app/lib/jm-rpc.server.ts`
- Modify: `app/components/chrome.tsx`
- Test: `app/lib/tasks.server.test.ts`

- [ ] **Step 1: 扩展任务 helper 失败测试**

在 `app/lib/tasks.server.test.ts` 追加：

```ts
test("mapTaskStatusTone keeps canceled and failed in error tone", () => {
  assert.equal(mapTaskStatusTone("canceled"), "error");
  assert.equal(mapTaskStatusTone("failed"), "error");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/tasks.server.test.ts`  
Expected: FAIL if helper does not cover canceled

- [ ] **Step 3: 实现“我的”页 loader 与 UI**

`app/routes/me.tsx` loader：

```tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const [favorites, tasks] = await Promise.all([
    fetchFavorites(request).catch(() => null),
    fetchTaskList(request).catch(() => []),
  ]);

  return json({ favorites, tasks });
}
```

`app/components/profile.tsx` 骨架：

```tsx
export function TaskListCard(props: { tasks: TaskSummary[] }) {
  return (
    <section className="profile-panel">
      <h2>导出任务</h2>
      {props.tasks.map((task) => (
        <div key={task.id} className={`task-row task-row--${mapTaskStatusTone(task.status)}`}>
          <div>{task.type}</div>
          <div>{task.status}</div>
        </div>
      ))}
    </section>
  );
}
```

页面要包含：

- 登录状态 / 登录入口
- 收藏夹概览
- 导出任务列表
- 下载入口与过期提示

- [ ] **Step 4: 跑测试与类型检查**

Run: `node --import tsx --test app/lib/tasks.server.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/me.tsx app/components/profile.tsx app/lib/jm-rpc.server.ts app/components/chrome.tsx app/lib/tasks.server.ts app/lib/tasks.server.test.ts
git commit -m "feat: add account favorites and tasks workspace"
```

---

## Task 9: Safari / 全尺寸屏幕回归与样式清理

**Files:**
- Modify: `app/styles/tokens.css`
- Modify: `app/styles/shell.css`
- Modify: `app/styles/components.css`
- Modify: `app/styles/reader.css`
- Modify: `app/styles/app.css`
- Test: `app/lib/reading-state.test.ts`

- [ ] **Step 1: 为阅读宽度与主题兼容规则补最终失败测试**

在 `app/lib/reading-state.test.ts` 追加：

```ts
test("normalizeThemeName remains deterministic for nullish values", () => {
  assert.equal(normalizeThemeName(undefined), "dark");
  assert.equal(normalizeThemeName(null), "dark");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test app/lib/reading-state.test.ts`  
Expected: FAIL if helper is not deterministic for nullish values

- [ ] **Step 3: 做样式清理与适配强化**

完成以下收尾：

- 清理 `app/styles/app.css` 中遗留旧样式，只保留兼容导入或最小桥接规则
- 为所有固定底栏、浮层、抽屉加入 `safe-area` padding
- 为超宽屏详情页、首页、发现页补充最大列宽与多区块布局
- 为 hover-only 反馈补 touch fallback
- 为 `backdrop-filter` 添加降级层

关键 CSS 片段：

```css
@media (min-width: 1440px) {
  .home-layout {
    grid-template-columns: 1.35fr 0.9fr;
  }

  .discover-layout {
    grid-template-columns: 320px minmax(0, 1fr);
  }
}

@media (hover: none) {
  .md-card:hover,
  .md-button:hover {
    transform: none;
  }
}
```

- [ ] **Step 4: 运行全量前端测试与类型检查**

Run: `node --import tsx --test app/lib/*.test.ts app/lib/**/*.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/styles/tokens.css app/styles/shell.css app/styles/components.css app/styles/reader.css app/styles/app.css app/lib/reading-state.ts app/lib/reading-state.test.ts
git commit -m "chore: harden safari responsiveness and performance"
```

---

## 验证清单

### 自动化

- `node --import tsx --test app/lib/*.test.ts app/lib/**/*.test.ts`
- `node --import tsx --test src/server/**/*.test.ts`
- `npm run typecheck`

### 手动联调

- `npm run api`
- `npm run dev`

重点检查：

1. 首页是否以 `GET /api/home` 驱动，且第一屏继续阅读优先
2. 搜索页 URL 驱动是否完整保留筛选条件
3. 发现页是否正确承接 `sub_category`
4. 详情页收藏与导出入口是否真实可用
5. 阅读器在 Safari 与 iPhone 全面屏模拟下是否稳定
6. “我的”页任务状态与下载入口是否正确

## 自检

- Spec coverage: 首页、搜索、发现、详情、阅读器、我的页、双主题、Safari、全尺寸屏幕、性能与占用控制均有任务承接
- Placeholder scan: 无 TBD / TODO / “稍后补”
- Type consistency: 统一使用 `sub_category`、`order_by`、`time`、`GET /api/home`、`/api/tasks/*`

