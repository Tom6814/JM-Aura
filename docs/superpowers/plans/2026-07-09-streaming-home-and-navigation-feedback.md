# Streaming Home and Navigation Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将首页改造成区块级流式返回，并为主导航接入 YouTube 风格的顶部细进度条与页面分段骨架，同时补齐局部重试。

**Architecture:** 保持 Remix 原生 `loader + defer + Await + Suspense` 作为主数据链路，不引入客户端瀑布式数据层。首页拆成 5 个独立异步区块，发现页和我的页沿用“壳子先出、内容后补”的边界；全局导航反馈统一收口到 `AppChrome`，局部骨架和重试逻辑保留在各页面组件内。

**Tech Stack:** Remix, React, TypeScript, node:test, CSS, existing `app/lib/*`, existing `app/components/*`, existing `app/routes/*`

---

## 0. 文件结构

### 需要新增的文件

- `app/lib/navigation-progress.ts`：统一封装顶部进度条的状态推进与收尾策略
- `app/lib/navigation-progress.test.ts`：进度条状态机测试
- `app/lib/home-stream.ts`：首页 5 个区块的流式数据装配、缓存 key、重试读取 helper
- `app/lib/home-stream.test.ts`：首页区块流式与缓存行为测试
- `app/components/loading.tsx`：顶部进度条、首页/发现/我的页骨架组件

### 需要重点修改的文件

- `app/components/chrome.tsx`：挂载顶部细进度条并接入 `useNavigation`
- `app/routes/_index.tsx`：首页 loader 拆分为 5 个区块 promise
- `app/components/home.tsx`：将首页改成 5 个独立 `Await` 区块并接入局部重试
- `app/routes/discover.tsx`：发现页内容流单独 `Await`，保留同步分类壳子
- `app/components/discover.tsx`：增加内容流骨架与局部重试
- `app/routes/me.tsx`：保留当前 defer 结构，但补局部重试入口和统一 loading 文案
- `app/components/profile.tsx`：为登录态 / 收藏夹 / 任务列表补局部重试 UI
- `app/lib/jm-rpc.server.ts`：下沉首页 / 发现页缓存粒度
- `app/lib/server-cache.ts`：按区块缓存，禁止缓存错误结果
- `app/styles/app.css`：进度条、骨架、局部错误态与 reduced-motion 降级
- `app/styles/components.css`：首页 / 发现 / 我的页的区块骨架与错误面板样式

### 测试与验证入口

- `app/lib/navigation-progress.test.ts`
- `app/lib/home-stream.test.ts`
- `app/lib/server-cache.test.ts`
- `app/lib/request-cookie.test.ts`
- `npm run typecheck`

---

## Task 1: 建立导航进度条状态机与全局加载反馈

**Files:**
- Create: `app/lib/navigation-progress.ts`
- Create: `app/lib/navigation-progress.test.ts`
- Modify: `app/components/chrome.tsx`
- Modify: `app/styles/app.css`
- Test: `app/lib/navigation-progress.test.ts`

- [ ] **Step 1: 写失败测试，锁定进度条状态推进规则**

创建 `app/lib/navigation-progress.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  getNavigationProgressSnapshot,
  reduceNavigationProgress,
} from "./navigation-progress";

test("reduceNavigationProgress starts visible progress for pending navigation", () => {
  const state = reduceNavigationProgress(
    { visible: false, value: 0, phase: "idle" },
    { type: "navigation-start" },
  );

  assert.equal(state.visible, true);
  assert.equal(state.phase, "running");
  assert.equal(state.value, 0.12);
});

test("reduceNavigationProgress caps running progress before completion", () => {
  const state = reduceNavigationProgress(
    { visible: true, value: 0.68, phase: "running" },
    { type: "tick" },
  );

  assert.equal(state.phase, "running");
  assert.equal(state.value <= 0.82, true);
});

test("getNavigationProgressSnapshot completes and hides after settle", () => {
  const snapshot = getNavigationProgressSnapshot({
    navigationState: "idle",
    hasPendingFetchers: false,
    previous: { visible: true, value: 0.74, phase: "running" },
  });

  assert.equal(snapshot.phase, "completing");
  assert.equal(snapshot.value, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/navigation-progress.test.ts`  
Expected: FAIL with `Cannot find module './navigation-progress'`

- [ ] **Step 3: 写最小实现并把进度条接入 AppChrome**

创建 `app/lib/navigation-progress.ts`：

```ts
export type NavigationProgressPhase = "idle" | "running" | "completing";

export type NavigationProgressState = {
  visible: boolean;
  value: number;
  phase: NavigationProgressPhase;
};

type NavigationProgressEvent =
  | { type: "navigation-start" }
  | { type: "tick" }
  | { type: "navigation-complete" };

export function reduceNavigationProgress(
  current: NavigationProgressState,
  event: NavigationProgressEvent,
): NavigationProgressState {
  if (event.type === "navigation-start") {
    return { visible: true, value: 0.12, phase: "running" };
  }

  if (event.type === "tick" && current.phase === "running") {
    return {
      ...current,
      value: Math.min(0.82, Number((current.value + 0.08).toFixed(2))),
    };
  }

  if (event.type === "navigation-complete") {
    return { visible: true, value: 1, phase: "completing" };
  }

  return current;
}

export function getNavigationProgressSnapshot(input: {
  navigationState: "idle" | "loading" | "submitting";
  hasPendingFetchers: boolean;
  previous: NavigationProgressState;
}): NavigationProgressState {
  if (input.navigationState !== "idle" || input.hasPendingFetchers) {
    return input.previous.visible
      ? reduceNavigationProgress(input.previous, { type: "tick" })
      : reduceNavigationProgress(input.previous, { type: "navigation-start" });
  }

  if (input.previous.visible && input.previous.phase !== "completing") {
    return reduceNavigationProgress(input.previous, { type: "navigation-complete" });
  }

  return input.previous;
}
```

在 `app/components/chrome.tsx` 中新增：

```tsx
const navigation = useNavigation();
const fetchers = useFetchers();
const [progress, setProgress] = useState<NavigationProgressState>({
  visible: false,
  value: 0,
  phase: "idle",
});

useEffect(() => {
  const next = getNavigationProgressSnapshot({
    navigationState: navigation.state,
    hasPendingFetchers: fetchers.some((fetcher) => fetcher.state !== "idle"),
    previous: progress,
  });
  setProgress(next);
}, [fetchers, navigation.state, progress]);
```

在底部导航上方插入：

```tsx
<div
  className={`app-nav-progress${progress.visible ? " app-nav-progress--visible" : ""}`}
  aria-hidden="true"
>
  <span
    className="app-nav-progress__bar"
    style={{ transform: `scaleX(${progress.value})` }}
  />
</div>
```

在 `app/styles/app.css` 中新增：

```css
.app-nav-progress {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 90;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
}

.app-nav-progress--visible {
  opacity: 1;
}

.app-nav-progress__bar {
  display: block;
  height: 2px;
  transform-origin: left center;
  background: var(--md-sys-color-primary);
  transition: transform 180ms ease;
}
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/navigation-progress.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/lib/navigation-progress.ts app/lib/navigation-progress.test.ts app/components/chrome.tsx app/styles/app.css
git commit -m "feat: add global navigation progress indicator"
```

---

## Task 2: 首页拆成 5 个独立流式区块

**Files:**
- Create: `app/lib/home-stream.ts`
- Create: `app/lib/home-stream.test.ts`
- Modify: `app/routes/_index.tsx`
- Modify: `app/components/home.tsx`
- Modify: `app/lib/jm-rpc.server.ts`
- Modify: `app/lib/server-cache.ts`
- Test: `app/lib/home-stream.test.ts`

- [ ] **Step 1: 写失败测试，锁定首页区块级装配与缓存边界**

创建 `app/lib/home-stream.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  createHomeStreamPayload,
  getHomeStreamCacheKey,
} from "./home-stream";

test("getHomeStreamCacheKey keeps latest and rankings isolated", () => {
  assert.equal(getHomeStreamCacheKey("latest", ""), "home:latest:");
  assert.equal(getHomeStreamCacheKey("ranking-week", ""), "home:ranking-week:");
});

test("createHomeStreamPayload exposes five independent sections", async () => {
  const payload = createHomeStreamPayload({
    continueReading: async () => ({ item: null, sourceLabel: "最新更新" }),
    latest: async () => [{ id: "1", name: "最新", tags: [], author: null, description: null, image: null }],
    rankingToday: async () => [],
    rankingWeek: async () => [],
    rankingMonth: async () => [],
  });

  assert.ok(payload.continueReading);
  assert.ok(payload.latest);
  assert.ok(payload.rankingToday);
  assert.ok(payload.rankingWeek);
  assert.ok(payload.rankingMonth);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/home-stream.test.ts`  
Expected: FAIL with `Cannot find module './home-stream'`

- [ ] **Step 3: 写最小实现并改造首页 loader**

创建 `app/lib/home-stream.ts`：

```ts
import type { SearchResultItem } from "../../src/shared/schema";

export type HomeStreamSectionKey =
  | "continue-reading"
  | "latest"
  | "ranking-today"
  | "ranking-week"
  | "ranking-month";

export function getHomeStreamCacheKey(
  key: Exclude<HomeStreamSectionKey, "continue-reading">,
  category: string,
) {
  return `home:${key}:${category}`;
}

export function createHomeStreamPayload(input: {
  continueReading: () => Promise<{ item: SearchResultItem | null; sourceLabel: string }>;
  latest: () => Promise<SearchResultItem[]>;
  rankingToday: () => Promise<SearchResultItem[]>;
  rankingWeek: () => Promise<SearchResultItem[]>;
  rankingMonth: () => Promise<SearchResultItem[]>;
}) {
  return {
    continueReading: input.continueReading(),
    latest: input.latest(),
    rankingToday: input.rankingToday(),
    rankingWeek: input.rankingWeek(),
    rankingMonth: input.rankingMonth(),
  };
}
```

在 `app/routes/_index.tsx` 中将：

```tsx
return defer({
  apiOrigin: getApiOrigin(request),
  homeData: loadHomeRouteData(request),
});
```

替换为：

```tsx
return defer({
  apiOrigin: getApiOrigin(request),
  homeStream: loadHomeStreamRouteData(request),
});
```

并把 `homeData.sections` 的整块渲染改成：

```tsx
<HomeReadingHub apiOrigin={data.apiOrigin} stream={data.homeStream} />
```

在 `app/components/home.tsx` 中将首页拆成 5 段：

```tsx
<Suspense fallback={<ContinueReadingMini item={null} sourceLabel="正在同步继续阅读…" />}>
  <Await resolve={props.stream.continueReading}>
    {(segment) => <ContinueReadingMini item={segment.item} sourceLabel={segment.sourceLabel} />}
  </Await>
</Suspense>
```

```tsx
<Suspense fallback={<HomeGridSkeleton count={12} />}>
  <Await resolve={props.stream.latest}>
    {(items) => <LatestSection apiOrigin={props.apiOrigin} items={items} />}
  </Await>
</Suspense>
```

```tsx
<Suspense fallback={<RankingPanelSkeleton title="今日热门" />}>
  <Await resolve={props.stream.rankingToday}>
    {(items) => <RankingPanel title="今日热门" href="/search?order_by=mv&time=t" items={items} />}
  </Await>
</Suspense>
```

同时在 `app/lib/jm-rpc.server.ts` 中把首页缓存粒度从整页下沉到：

```ts
const HOME_SECTION_CACHE_TTL_MS = 15_000;
```

并改成分别缓存 `latest`、`ranking-today`、`ranking-week`、`ranking-month`。

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/home-stream.test.ts app/lib/server-cache.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/lib/home-stream.ts app/lib/home-stream.test.ts app/routes/_index.tsx app/components/home.tsx app/lib/jm-rpc.server.ts app/lib/server-cache.ts
git commit -m "feat: stream home sections independently"
```

---

## Task 3: 为首页区块补骨架、错误态和局部重试

**Files:**
- Create: `app/components/loading.tsx`
- Modify: `app/components/home.tsx`
- Modify: `app/styles/app.css`
- Modify: `app/styles/components.css`
- Test: `app/lib/home-stream.test.ts`

- [ ] **Step 1: 扩展失败测试，锁定首页区块错误态与重试文案**

在 `app/lib/home-stream.test.ts` 追加：

```ts
test("createHomeStreamPayload keeps retryable segment descriptors stable", async () => {
  const payload = createHomeStreamPayload({
    continueReading: async () => ({ item: null, sourceLabel: "最新更新" }),
    latest: async () => [],
    rankingToday: async () => [],
    rankingWeek: async () => [],
    rankingMonth: async () => [],
  });

  assert.equal(typeof payload.latest.then, "function");
  assert.equal(typeof payload.rankingMonth.then, "function");
});
```

- [ ] **Step 2: 运行测试确认失败或暴露边界不完整**

Run: `node --import tsx --test app/lib/home-stream.test.ts`  
Expected: FAIL if helper drifted or segment shape is missing

- [ ] **Step 3: 写骨架组件并接入局部重试**

创建 `app/components/loading.tsx`：

```tsx
export function HomeGridSkeleton(props: { count: number }) {
  return (
    <div className="home-grid">
      {Array.from({ length: props.count }).map((_, index) => (
        <div key={index} className="content-skeleton-card" aria-hidden="true" />
      ))}
    </div>
  );
}

export function RankingPanelSkeleton(props: { title: string }) {
  return (
    <section className="home-ranking-panel">
      <header className="home-ranking-panel__header">
        <h3 className="home-ranking-panel__title">{props.title}</h3>
      </header>
      <div className="content-skeleton-list">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="content-skeleton-row" aria-hidden="true" />
        ))}
      </div>
    </section>
  );
}
```

在 `app/components/home.tsx` 每个 `Await` 上补 `errorElement`：

```tsx
<Await
  resolve={props.stream.latest}
  errorElement={
    <StatusPanel
      tone="error"
      title="最新更新加载失败"
      description="当前区块没有同步成功。"
      action={<button type="button" className="md-button md-button--primary">重试</button>}
    />
  }
>
```

在 `app/styles/app.css` 中补：

```css
.content-skeleton-card,
.content-skeleton-row {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  background: var(--md-sys-color-surface-container);
}

.content-skeleton-card {
  min-height: 228px;
}

.content-skeleton-row {
  min-height: 56px;
}

.content-skeleton-card::after,
.content-skeleton-row::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.08), transparent);
  animation: content-shimmer 1.4s ease infinite;
}
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/home-stream.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/loading.tsx app/components/home.tsx app/styles/app.css app/styles/components.css app/lib/home-stream.test.ts
git commit -m "feat: add home skeletons and retry states"
```

---

## Task 4: 发现页与我的页接入同一套局部加载和重试模型

**Files:**
- Modify: `app/routes/discover.tsx`
- Modify: `app/components/discover.tsx`
- Modify: `app/routes/me.tsx`
- Modify: `app/components/profile.tsx`
- Modify: `app/components/loading.tsx`
- Test: `app/lib/request-cookie.test.ts`

- [ ] **Step 1: 补失败测试，锁定无 `jm_session` 时不探测收藏夹**

在 `app/lib/request-cookie.test.ts` 追加：

```ts
test("hasRequestCookie only matches exact cookie names", () => {
  assert.equal(
    hasRequestCookie("jm_session_backup=1; theme=dark", "jm_session"),
    false,
  );
});
```

- [ ] **Step 2: 运行测试确认失败或暴露 cookie 判断问题**

Run: `node --import tsx --test app/lib/request-cookie.test.ts`  
Expected: FAIL if cookie matching is too loose

- [ ] **Step 3: 补发现页 / 我的页的局部骨架与重试**

在 `app/components/discover.tsx` 中把当前：

```tsx
{props.loading ? (
  <StatusPanel
    tone="accent"
    title="正在刷新发现流"
    description="分类轨道先显示，内容列表稍后填充。"
  />
) : ...}
```

替换为：

```tsx
{props.loading ? (
  <section className="compact-panel">
    <SectionHeader eyebrow="内容" title="正在刷新发现流" description="分类轨道先显示，内容列表稍后填充。" />
    <DiscoverGridSkeleton count={12} />
  </section>
) : ...}
```

在 `app/components/profile.tsx` 中对登录态 / 收藏夹 / 任务列表的错误区块统一补：

```tsx
<StatusPanel
  tone="error"
  title="任务列表刷新失败"
  description="当前区块没有同步成功。"
  action={<button type="button" className="md-button md-button--primary">重试</button>}
/>
```

在 `app/routes/me.tsx` 中保留：

```ts
const hasSession = hasRequestCookie(request.headers.get("Cookie"), "jm_session");
```

禁止把没有 session 的场景重新退回到慢 401 探测。

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/request-cookie.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/discover.tsx app/components/discover.tsx app/routes/me.tsx app/components/profile.tsx app/components/loading.tsx app/lib/request-cookie.test.ts
git commit -m "feat: extend streaming feedback to discover and profile"
```

---

## Task 5: reduced-motion、回归验证与文档同步

**Files:**
- Modify: `app/styles/app.css`
- Modify: `app/styles/components.css`
- Modify: `docs/superpowers/specs/2026-07-09-streaming-home-and-navigation-feedback-design.md`
- Test: `app/lib/navigation-progress.test.ts`
- Test: `app/lib/home-stream.test.ts`
- Test: `app/lib/server-cache.test.ts`

- [ ] **Step 1: 补失败测试，锁定缓存不缓存错误结果**

在 `app/lib/server-cache.test.ts` 追加：

```ts
test("readThroughServerCache does not cache rejected loaders", async () => {
  let calls = 0;

  await assert.rejects(() =>
    readThroughServerCache("home:error", 1_000, async () => {
      calls += 1;
      throw new Error("boom");
    }),
  );

  await assert.rejects(() =>
    readThroughServerCache("home:error", 1_000, async () => {
      calls += 1;
      throw new Error("boom");
    }),
  );

  assert.equal(calls, 2);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/server-cache.test.ts`  
Expected: FAIL if error results are cached incorrectly

- [ ] **Step 3: 完成降级样式与文档回填**

在 `app/styles/app.css` 中补：

```css
@media (prefers-reduced-motion: reduce) {
  .app-nav-progress__bar,
  .content-skeleton-card::after,
  .content-skeleton-row::after {
    animation: none;
    transition: none;
  }
}
```

在 `app/lib/server-cache.ts` 中保持：

```ts
.catch((error) => {
  inflightCache.delete(key);
  throw error;
});
```

并确认不会写入 `valueCache`。

最后在设计文档追加“已实现边界”说明：

```md
- 顶部细进度条由 `AppChrome` 统一驱动
- 首页按 5 个区块独立 `Await`
- 发现与我的保留较粗粒度局部流式
```

- [ ] **Step 4: 运行全量相关测试与类型检查**

Run: `node --import tsx --test app/lib/navigation-progress.test.ts app/lib/home-stream.test.ts app/lib/server-cache.test.ts app/lib/request-cookie.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/styles/app.css app/styles/components.css app/lib/server-cache.ts app/lib/server-cache.test.ts docs/superpowers/specs/2026-07-09-streaming-home-and-navigation-feedback-design.md
git commit -m "chore: finish streaming home and loading feedback polish"
```

---

## 验证清单

### 自动化

- `node --import tsx --test app/lib/navigation-progress.test.ts`
- `node --import tsx --test app/lib/home-stream.test.ts`
- `node --import tsx --test app/lib/server-cache.test.ts`
- `node --import tsx --test app/lib/request-cookie.test.ts`
- `npm run typecheck`

### 手动联调

- `npm run api`
- `npm run dev`

重点检查：

1. 点击底部导航后，顶部细进度条是否能立即出现
2. 首页工具条是否先于最新 / 排行榜内容出现
3. 首页 `continue-reading`、`latest`、`today`、`week`、`month` 是否独立落地
4. 某个首页区块失败时，其他区块是否仍然可见
5. 首页 / 发现 / 我的页的 `重试` 是否只影响当前区块
6. 第二次切回首页 / 发现时，缓存命中是否明显减少等待
7. Safari 下骨架、进度条和布局是否稳定
8. `prefers-reduced-motion` 下是否自动降级为更静态的反馈

## 自检

- Spec coverage: 首页分段流式、顶部细进度条、页面分段骨架、局部错误与局部重试、缓存粒度下沉、discover / profile 复用同一模型均有任务承接
- Placeholder scan: 无 `TODO` / `TBD` / “稍后补”
- Type consistency: 统一使用 `homeStream`、`NavigationProgressState`、`HomeGridSkeleton`、`RankingPanelSkeleton`、`hasRequestCookie`
