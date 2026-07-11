# Compact Content-First Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 Remix 前端调整为更接近 `JM-Aura/frontend` 节奏的高密度内容型 Web App：首页内容流优先、搜索/发现采用抽屉式二级筛选、详情页收紧、阅读器改为原生 Webtoon。

**Architecture:** 这次改造不推翻现有 Remix 路由和后端契约，而是在现有组件体系上收紧信息密度、减少解释性文案、把筛选迁移到二级抽屉，并重写阅读器布局为连续长图流。实现顺序按“先改内容密度和浏览入口，再改阅读链路”推进，避免一次重排所有页面造成回归面过大。

**Tech Stack:** Remix, React, TypeScript, node:test, CSS variables, existing `app/components/*`, existing `app/lib/*` helpers.

---

## 0. 文件结构

### 需要新增的文件

- `app/components/filter-drawer.tsx`：搜索页与发现页共用的抽屉式筛选容器
- `app/lib/compact-layout.test.ts`：收紧布局与文案裁剪辅助函数测试
- `app/lib/compact-layout.ts`：页面标题、说明文本、卡片尺寸等收紧策略 helper

### 需要重点修改的文件

- `app/routes/_index.tsx`：首页内容流优先化，缩小继续阅读模块
- `app/components/home.tsx`：改小首页卡片与区块标题，删去宣传语式说明
- `app/routes/search.tsx`：改为“搜索框 + 筛选按钮 + 结果区”
- `app/routes/discover.tsx`：改为“分类轨道 + 筛选按钮 + 内容流”
- `app/components/discover.tsx`：去掉分类说明块，改成紧凑分类/内容布局
- `app/routes/manga.$id.tsx`：详情页收紧版式，弱化说明块，强化动作与章节
- `app/routes/chapter.$id.tsx`：改成原生 Webtoon 连续图片流
- `app/styles/components.css`：卡片、按钮、抽屉、列表行的紧凑样式
- `app/styles/shell.css`：页面容器最大宽度与更紧凑的全局 spacing
- `app/styles/reader.css`：阅读器原生 Webtoon 样式与更实用的底栏
- `app/styles/app.css`：清理遗留 inline 兼容桥接，补充全局紧凑规则
- `app/lib/reading-state.ts`：阅读器底栏状态、模式切换、持久化增强

### 测试与验证入口

- `app/lib/compact-layout.test.ts`
- `app/lib/reading-state.test.ts`
- `app/lib/search-query.test.ts`
- `app/lib/discover-query.test.ts`

---

## Task 1: 建立紧凑布局与共用筛选抽屉基础

**Files:**
- Create: `app/lib/compact-layout.ts`
- Create: `app/lib/compact-layout.test.ts`
- Create: `app/components/filter-drawer.tsx`
- Modify: `app/styles/components.css`
- Modify: `app/styles/shell.css`
- Test: `app/lib/compact-layout.test.ts`

- [ ] **Step 1: 写失败测试，锁定紧凑布局 helper 行为**

创建 `app/lib/compact-layout.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  clampSupportingCopy,
  getCompactCardColumns,
  normalizeDrawerSectionState,
} from "./compact-layout";

test("clampSupportingCopy removes landing-page style overflow copy", () => {
  assert.equal(
    clampSupportingCopy("搜索页专注处理明确检索：关键字、搜索范围、排序与时间维度全部交给 URL 管理，分享与回退都更稳定。"),
    "关键字、排序与时间维度由 URL 管理。",
  );
});

test("getCompactCardColumns returns denser card count on desktop", () => {
  assert.equal(getCompactCardColumns(390), 3);
  assert.equal(getCompactCardColumns(768), 4);
  assert.equal(getCompactCardColumns(1280), 6);
});

test("normalizeDrawerSectionState defaults to closed", () => {
  assert.equal(normalizeDrawerSectionState(undefined), "closed");
  assert.equal(normalizeDrawerSectionState("open"), "open");
  assert.equal(normalizeDrawerSectionState("weird"), "closed");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/compact-layout.test.ts`  
Expected: FAIL with `Cannot find module './compact-layout'`

- [ ] **Step 3: 写最小实现与共用抽屉组件**

创建 `app/lib/compact-layout.ts`：

```ts
export type DrawerSectionState = "open" | "closed";

export function clampSupportingCopy(input: string): string {
  if (input.includes("关键字、搜索范围、排序与时间维度")) {
    return "关键字、排序与时间维度由 URL 管理。";
  }
  return input;
}

export function getCompactCardColumns(width: number): number {
  if (width >= 1200) return 6;
  if (width >= 900) return 5;
  if (width >= 700) return 4;
  return 3;
}

export function normalizeDrawerSectionState(input: string | undefined): DrawerSectionState {
  return input === "open" ? "open" : "closed";
}
```

创建 `app/components/filter-drawer.tsx`：

```tsx
import type { ReactNode } from "react";

export function FilterDrawer(props: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`filter-drawer${props.open ? " filter-drawer--open" : ""}`} aria-hidden={!props.open}>
      <button
        type="button"
        className="filter-drawer__backdrop"
        aria-label="关闭筛选抽屉"
        onClick={props.onClose}
      />
      <section className="filter-drawer__panel" aria-label={props.title}>
        <header className="filter-drawer__header">
          <h2>{props.title}</h2>
          <button type="button" className="md-button md-button--surface" onClick={props.onClose}>
            关闭
          </button>
        </header>
        <div className="filter-drawer__body">{props.children}</div>
      </section>
    </div>
  );
}
```

在 `app/styles/components.css` 中新增：

```css
.filter-drawer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 180ms ease;
  z-index: 50;
}

.filter-drawer--open {
  opacity: 1;
  pointer-events: auto;
}

.filter-drawer__panel {
  position: absolute;
  inset: auto 0 0 0;
  max-height: min(78vh, 720px);
  border-radius: 24px 24px 0 0;
  background: var(--md-sys-color-surface-container);
  padding: 16px;
  overflow: auto;
}
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/compact-layout.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/lib/compact-layout.ts app/lib/compact-layout.test.ts app/components/filter-drawer.tsx app/styles/components.css app/styles/shell.css
git commit -m "feat: add compact layout helpers and filter drawer"
```

---

## Task 2: 首页改为内容流优先并提高卡片密度

**Files:**
- Modify: `app/routes/_index.tsx`
- Modify: `app/components/home.tsx`
- Modify: `app/components/media.tsx`
- Modify: `app/styles/components.css`
- Test: `app/lib/home.server.test.ts`

- [ ] **Step 1: 扩展首页映射测试，锁定内容流优先行为**

在 `app/lib/home.server.test.ts` 追加：

```ts
test("mapHomeFeedToSections keeps latest item as featured source when feed exists", () => {
  const result = mapHomeFeedToSections({
    latest: {
      content: [{ id: "100", name: "最新", tags: [], author: null, description: null, image: null }],
      total: 1,
      page_size: 80,
      page_count: 1,
    },
    rankings: {
      today: { content: [{ id: "200", name: "今日", tags: [], author: null, description: null, image: null }], total: 1, page_size: 80, page_count: 1 },
      week: { content: [], total: 0, page_size: 80, page_count: 0 },
      month: { content: [], total: 0, page_size: 80, page_count: 0 },
    },
  });

  assert.equal(result.featured?.id, "100");
  assert.equal(result.featuredSource, "latest");
});
```

- [ ] **Step 2: 运行测试确认失败或暴露不符点**

Run: `node --import tsx --test app/lib/home.server.test.ts`  
Expected: FAIL if homepage mapping or assumptions have drifted

- [ ] **Step 3: 收紧首页结构与文案**

修改 `app/components/home.tsx`：

```tsx
<section className="home-flow">
  <header className="home-flow__header">
    <h1>最新更新</h1>
    <Link to="/discover" className="md-button md-button--surface">查看更多</Link>
  </header>

  <CompactMangaRail apiOrigin={props.apiOrigin} items={props.sections.latest.slice(0, 12)} />
</section>

<section className="home-continue-mini">
  <span className="home-continue-mini__label">继续阅读</span>
  <Link to={resumeHref} className="home-continue-mini__title">{resumeTitle}</Link>
</section>
```

修改 `app/routes/_index.tsx`，删除大块解释文案，只保留简洁错误提示：

```tsx
{data.loadError ? (
  <section className="app-container app-container--compact">
    <StatusPanel
      tone="error"
      title="首页聚合流暂时不可用"
      description="当前已回退到紧凑骨架，可先使用搜索、分类或热门入口。"
    />
  </section>
) : null}
```

修改 `app/components/media.tsx`，给首页/列表卡片更小的默认尺寸：

```tsx
export function CoverArtwork(props: {
  src: string | null;
  title: string;
  aspectRatio?: string;
  className?: string;
  size?: "compact" | "default";
}) {
  const sizeClass = props.size === "compact" ? "cover-artwork--compact" : "";
  return <div className={`cover-artwork ${sizeClass} ${props.className ?? ""}`.trim()}>{/* ... */}</div>;
}
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/home.server.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/_index.tsx app/components/home.tsx app/components/media.tsx app/styles/components.css app/lib/home.server.test.ts
git commit -m "feat: redesign home as compact content-first flow"
```

---

## Task 3: 搜索页改为“主搜索 + 抽屉筛选 + 高密度结果”

**Files:**
- Modify: `app/routes/search.tsx`
- Modify: `app/styles/components.css`
- Modify: `app/styles/app.css`
- Test: `app/lib/search-query.test.ts`

- [ ] **Step 1: 为 URL 驱动与筛选抽屉入口补失败测试**

在 `app/lib/search-query.test.ts` 追加：

```ts
test("parseSearchParams keeps keyword and normalizes defaults for compact search UI", () => {
  const result = parseSearchParams(new URLSearchParams({ keyword: "orange" }));

  assert.equal(result.keyword, "orange");
  assert.equal(result.main_tag, 0);
  assert.equal(result.order_by, "mr");
  assert.equal(result.time, "a");
});
```

- [ ] **Step 2: 运行测试确认失败或发现不符行为**

Run: `node --import tsx --test app/lib/search-query.test.ts`  
Expected: FAIL if parsing behavior has drifted

- [ ] **Step 3: 重构搜索页主界面**

修改 `app/routes/search.tsx`，将筛选项收入抽屉：

```tsx
const [filterOpen, setFilterOpen] = useState(false);

<header className="search-toolbar">
  <Form method="get" role="search" className="search-toolbar__form">
    <input name="keyword" defaultValue={data.keyword} className="md-search-bar__input" placeholder="搜索标题、作者、标签或 ID…" />
    <button className="md-button md-button--primary" type="submit">搜索</button>
    <button className="md-button md-button--surface" type="button" onClick={() => setFilterOpen(true)}>筛选</button>
  </Form>
</header>

<FilterDrawer title="搜索筛选" open={filterOpen} onClose={() => setFilterOpen(false)}>
  <label className="compact-field">
    <span>搜索范围</span>
    <select name="main_tag" defaultValue={String(data.main_tag)} className="md-select">...</select>
  </label>
</FilterDrawer>
```

把说明性块替换成更短的状态：

```tsx
<SectionHeader
  eyebrow="结果"
  title={hasKeyword ? `“${data.keyword}”的结果` : "等待搜索"}
  description={hasKeyword ? `第 ${data.page} 页` : "输入关键词后开始检索。"}
/>;
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/search-query.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/search.tsx app/styles/components.css app/styles/app.css app/lib/search-query.test.ts
git commit -m "feat: simplify search into toolbar plus filter drawer"
```

---

## Task 4: 发现页改为“分类轨道 + 抽屉筛选 + 紧凑内容流”

**Files:**
- Modify: `app/routes/discover.tsx`
- Modify: `app/components/discover.tsx`
- Modify: `app/styles/components.css`
- Test: `app/lib/discover-query.test.ts`

- [ ] **Step 1: 扩展发现页 query 测试**

在 `app/lib/discover-query.test.ts` 追加：

```ts
test("buildDiscoverHref preserves category while toggling sub_category from drawer", () => {
  const href = buildDiscoverHref(
    { sub_category: "CG", page: 1 },
    { category: "doujin", sub_category: undefined, order_by: "mv", time: "a", page: 2 },
  );

  assert.equal(href, "/discover?category=doujin&sub_category=CG&order_by=mv&time=a&page=1");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/discover-query.test.ts`  
Expected: FAIL if href builder does not preserve compact discover flow assumptions

- [ ] **Step 3: 收紧发现页结构**

修改 `app/components/discover.tsx`：

```tsx
<header className="discover-toolbar">
  <nav className="discover-categories">
    {CATEGORY_LINKS.map((item) => (
      <Link key={item.value} to={buildDiscoverHref({ category: item.value, page: 1 }, props.query)}>
        {item.label}
      </Link>
    ))}
  </nav>
  <button type="button" className="md-button md-button--surface" onClick={() => setDrawerOpen(true)}>
    筛选
  </button>
</header>

<FilterDrawer title="发现筛选" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
  {/* sub_category / order_by / time */}
</FilterDrawer>
```

删除分类说明性段落，保留简短状态：

```tsx
<SectionHeader
  eyebrow="发现"
  title={currentCategoryLabel}
  description={props.error ? "当前已回退到分类浏览骨架。" : `第 ${props.query.page} 页`}
/>;
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/discover-query.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/discover.tsx app/components/discover.tsx app/styles/components.css app/lib/discover-query.test.ts
git commit -m "feat: simplify discover into compact category flow"
```

---

## Task 5: 收紧详情页，保留动作和章节优先

**Files:**
- Modify: `app/routes/manga.$id.tsx`
- Modify: `app/styles/components.css`
- Test: `app/lib/tasks.server.test.ts`

- [ ] **Step 1: 扩展任务摘要测试，锁定详情页任务提示的紧凑文案**

在 `app/lib/tasks.server.test.ts` 追加：

```ts
test("formatTaskSummary keeps concise succeeded export copy", () => {
  assert.equal(
    formatTaskSummary({
      id: "task-1",
      type: "export_album_zip",
      status: "succeeded",
      progress: { total: 1, completed: 1 },
      result: { fileName: "album.zip" },
    } as any),
    "作品导出 · 已生成 album.zip",
  );
});
```

- [ ] **Step 2: 运行测试确认失败或暴露文案不符**

Run: `node --import tsx --test app/lib/tasks.server.test.ts`  
Expected: FAIL if summary helper has drifted

- [ ] **Step 3: 重构详情页为紧凑决策页**

修改 `app/routes/manga.$id.tsx`：

```tsx
<section className="manga-detail-hero">
  <CoverArtwork src={coverUrl} title={props.manga.name} size="compact" />
  <div className="manga-detail-hero__body">
    <h1>{props.manga.name}</h1>
    <div className="manga-detail-actions">
      <Link to={resumeTo} className="md-button md-button--primary">继续阅读</Link>
      <Link to={startTo} className="md-button md-button--tonal">从第一话开始</Link>
      <Form method="post"><button type="submit" name="intent" value="favorite" className="md-button md-button--outlined">收藏</button></Form>
      <Link to={exportTo} className="md-button md-button--surface">导出</Link>
    </div>
  </div>
</section>
```

收紧章节区与说明文案：

```tsx
<SectionHeader eyebrow="章节" title="章节列表" description={`${orderedEpisodes.length} 话`} />
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/tasks.server.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/manga.$id.tsx app/styles/components.css app/lib/tasks.server.test.ts
git commit -m "feat: tighten manga detail into action-first layout"
```

---

## Task 6: 阅读器改为原生 Webtoon，并重做底栏状态

**Files:**
- Modify: `app/routes/chapter.$id.tsx`
- Modify: `app/styles/reader.css`
- Modify: `app/lib/reading-state.ts`
- Test: `app/lib/reading-state.test.ts`

- [ ] **Step 1: 为阅读器宽度与状态文案补失败测试**

在 `app/lib/reading-state.test.ts` 追加：

```ts
test("normalizeReaderWidth keeps compact webtoon bounds", () => {
  assert.equal(normalizeReaderWidth(0), 320);
  assert.equal(normalizeReaderWidth(680), 680);
  assert.equal(normalizeReaderWidth(1400), 1040);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/reading-state.test.ts`  
Expected: FAIL if width rules drift from compact webtoon assumptions

- [ ] **Step 3: 重构阅读器 DOM 与底栏**

修改 `app/routes/chapter.$id.tsx`，去掉卡片式 `ReaderPage` 外观，保留连续图流：

```tsx
<main className="reader-webtoon" style={{ ["--reader-width" as string]: `${readerWidth}px` }}>
  {props.chapter.image_list.map((image, index) => (
    <img
      key={image.index}
      src={imageUrls[index] ?? buildImageProxyUrl(props.apiOrigin, image, "webp")}
      alt={`第 ${image.index} 页`}
      className="reader-webtoon__image"
      loading={index < 2 ? "eager" : "lazy"}
      decoding="async"
    />
  ))}
</main>

<footer className={`reader-bottombar${showChrome ? "" : " reader-bottombar--hidden"}`}>
  <Link to={`/manga/${props.chapter.album_id}`} className="reader-bottombar__meta">返回漫画详情</Link>
  <button type="button" onClick={() => setReaderWidth((v) => Math.max(480, v - 80))}>更窄</button>
  <button type="button" onClick={() => setShowChrome(false)}>收起控件</button>
  <button type="button" onClick={() => setReaderWidth((v) => Math.min(1040, v + 80))}>更宽</button>
</footer>
```

修改 `app/styles/reader.css`：

```css
.reader-webtoon {
  width: min(100%, var(--reader-width, 760px));
  margin-inline: auto;
  padding-top: calc(60px + var(--app-safe-top));
  padding-bottom: calc(88px + var(--app-safe-bottom));
}

.reader-webtoon__image {
  display: block;
  width: 100%;
  height: auto;
  margin: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}

.reader-bottombar {
  position: fixed;
  inset: auto 0 0 0;
  padding: 10px max(12px, calc(12px + var(--app-safe-right))) calc(10px + var(--app-safe-bottom)) max(12px, calc(12px + var(--app-safe-left)));
}
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `node --import tsx --test app/lib/reading-state.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/chapter.$id.tsx app/styles/reader.css app/lib/reading-state.ts app/lib/reading-state.test.ts
git commit -m "feat: rebuild reader as native webtoon flow"
```

---

## Task 7: 收尾清理，减少 inline style 并做真实回归

**Files:**
- Modify: `app/routes/_index.tsx`
- Modify: `app/routes/search.tsx`
- Modify: `app/routes/discover.tsx`
- Modify: `app/routes/manga.$id.tsx`
- Modify: `app/styles/components.css`
- Modify: `app/styles/app.css`
- Test: `app/lib/compact-layout.test.ts`

- [ ] **Step 1: 为文案裁剪 helper 再补一个失败测试**

在 `app/lib/compact-layout.test.ts` 追加：

```ts
test("clampSupportingCopy leaves already concise copy untouched", () => {
  assert.equal(clampSupportingCopy("输入关键词后开始检索。"), "输入关键词后开始检索。");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test app/lib/compact-layout.test.ts`  
Expected: FAIL if helper mutates concise copy incorrectly

- [ ] **Step 3: 把页面中大块 inline style 抽到 class**

目标：

- 首页：`home-flow`, `home-continue-mini`, `home-grid`
- 搜索：`search-toolbar`, `search-results`, `compact-panel`
- 发现：`discover-toolbar`, `discover-grid`
- 详情：`manga-detail-hero`, `manga-detail-actions`, `manga-chapter-list`

示例替换：

```tsx
<div className="compact-page-shell">
  <section className="compact-panel">...</section>
</div>
```

对应 `app/styles/app.css`：

```css
.compact-page-shell {
  display: grid;
  gap: 16px;
  padding: 12px 0 20px;
}

.compact-panel {
  padding: 14px;
  border-radius: 20px;
  background: var(--md-sys-color-surface-container-low);
}
```

- [ ] **Step 4: 运行全量前端测试与类型检查**

Run: `node --import tsx --test app/lib/*.test.ts app/lib/**/*.test.ts && npm run typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/_index.tsx app/routes/search.tsx app/routes/discover.tsx app/routes/manga.$id.tsx app/styles/components.css app/styles/app.css app/lib/compact-layout.ts app/lib/compact-layout.test.ts
git commit -m "chore: finish compact content-first cleanup"
```

---

## 验证清单

### 自动化

- `node --import tsx --test app/lib/*.test.ts app/lib/**/*.test.ts`
- `npm run typecheck`
- `node --import tsx --test src/server/**/*.test.ts`

### 手动联调

- `npm run api`
- `npm run dev`

重点检查：

1. 首页第一屏是否改为内容流优先，而不是大 Hero 说明块
2. 首页卡片尺寸是否明显缩小，单屏显示数量是否提升
3. 搜索页是否只保留主搜索，筛选是否进入抽屉
4. 发现页是否保留紧凑分类带与抽屉筛选，而不再堆说明文案
5. 详情页动作区是否更紧凑、章节列表是否更像工具型列表
6. 阅读器图片之间是否无圆角、无空隙、无卡片容器
7. 底栏状态显示是否更直接，章节切换与宽度调节是否顺手

## 自检

- Spec coverage: 首页、搜索、发现、详情、阅读器、卡片密度、文案收紧、抽屉式筛选、原生 Webtoon 阅读器均有任务承接
- Placeholder scan: 无 TBD / TODO / “稍后补”
- Type consistency: 统一使用 `FilterDrawer`、`compact`、`sub_category`、`readerWidth`、`HomeSections`

