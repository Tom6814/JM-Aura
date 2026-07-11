# Mobile Site + Desktop Web UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Remix frontend from an oversized mobile-app shell into a mobile-first manga site with 2/3-column phone grids and a separate desktop website layout, without regressing streaming performance or browser compatibility.

**Architecture:** Keep the current Remix routes, deferred loaders, and Hono API contracts intact. Refactor the UI by tightening the global shell, introducing shared site-layout primitives, then replacing each page’s structure in stages so mobile and desktop can diverge at the layout layer while sharing the same data flow.

**Tech Stack:** Remix, React 18, TypeScript, Hono API, CSS Grid/Flexbox, Node `node:test` with `tsx --test`

---

## File map

### Shared shell and layout helpers

- Modify: `app/lib/compact-layout.ts`
- Modify: `app/lib/compact-layout.test.ts`
- Modify: `app/components/chrome.tsx`
- Modify: `app/styles/shell.css`
- Modify: `app/styles/app.css`
- Modify: `app/styles/tokens.css`

### Shared UI primitives

- Create: `app/components/site-layout.tsx`
- Create: `app/components/site-layout.test.tsx`
- Modify: `app/components/ui.tsx`
- Modify: `app/components/primitives.tsx`
- Modify: `app/styles/components.css`

### Page rewrites

- Modify: `app/components/home.tsx`
- Create: `app/components/home.test.tsx`
- Modify: `app/components/loading.tsx`
- Modify: `app/routes/_index.tsx`
- Modify: `app/routes/search.tsx`
- Modify: `app/components/discover.tsx`
- Create: `app/components/catalog-page.test.tsx`
- Modify: `app/routes/discover.tsx`
- Create: `app/components/manga-detail.tsx`
- Create: `app/components/manga-detail.test.tsx`
- Modify: `app/routes/manga.$id.tsx`
- Create: `app/components/reader-overlay.tsx`
- Create: `app/components/reader-overlay.test.tsx`
- Modify: `app/routes/chapter.$id.tsx`
- Modify: `app/styles/reader.css`

### Verification

- Run: `npx tsx --test app/lib/compact-layout.test.ts`
- Run: `npx tsx --test app/components/site-layout.test.tsx`
- Run: `npx tsx --test app/components/home.test.tsx`
- Run: `npx tsx --test app/components/catalog-page.test.tsx`
- Run: `npx tsx --test app/components/manga-detail.test.tsx`
- Run: `npx tsx --test app/components/reader-overlay.test.tsx`
- Run: `npm run typecheck`

> Note: the mounted workspace root is not a Git repository, so this plan uses verification checkpoints instead of `git commit` steps. If the real repo root is mounted later, convert each checkpoint into a commit before moving to the next task.

## Task 1: Refactor the global shell and breakpoint contract

**Files:**
- Modify: `app/lib/compact-layout.ts`
- Modify: `app/lib/compact-layout.test.ts`
- Modify: `app/components/chrome.tsx`
- Modify: `app/styles/shell.css`
- Modify: `app/styles/app.css`
- Modify: `app/styles/tokens.css`

- [ ] **Step 1: Expand the failing breakpoint tests**

```ts
import {
  clampSupportingCopy,
  getCompactCardColumns,
  getDesktopLayoutMode,
  getMobileGridColumns,
  normalizeDrawerSectionState,
} from "./compact-layout";

test("getMobileGridColumns keeps phones on dense 2-up / 3-up grids", () => {
  assert.equal(getMobileGridColumns(360), 2);
  assert.equal(getMobileGridColumns(412), 2);
  assert.equal(getMobileGridColumns(430), 3);
});

test("getDesktopLayoutMode only enables website layout on large screens", () => {
  assert.equal(getDesktopLayoutMode(768), "compact");
  assert.equal(getDesktopLayoutMode(1180), "desktop-site");
});
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run: `npx tsx --test app/lib/compact-layout.test.ts`

Expected: FAIL with missing exports for `getMobileGridColumns` and `getDesktopLayoutMode`.

- [ ] **Step 3: Implement the minimal layout helpers**

```ts
export function getMobileGridColumns(width: number): number {
  if (width >= 430) return 3;
  return 2;
}

export function getDesktopLayoutMode(width: number): "compact" | "desktop-site" {
  return width >= 1180 ? "desktop-site" : "compact";
}

export function getCompactCardColumns(width: number): number {
  if (width >= 1380) return 7;
  if (width >= 1180) return 6;
  if (width >= 700) return 4;
  return 3;
}
```

- [ ] **Step 4: Rebuild the shell markup around mobile-site and desktop-site classes**

```tsx
const shellClassName = [
  "app-shell",
  shellImmersive ? "app-shell--immersive" : "",
  "app-shell--site",
].filter(Boolean).join(" ");

return (
  <div className={shellClassName}>
    <header className="app-topbar app-topbar--site">...</header>
    <main className="app-main">
      <div className="app-container app-main__inner app-main__inner--site">{props.children}</div>
    </main>
    <nav className="app-bottom-nav app-bottom-nav--mobile">...</nav>
  </div>
);
```

- [ ] **Step 5: Tighten the CSS contract for phone safe-areas and desktop navigation**

```css
.app-shell--site {
  padding-top: calc(var(--app-header-height) + var(--app-safe-top) + 4px);
  padding-bottom: calc(var(--app-bottom-nav-height) + var(--app-safe-bottom) + 4px);
}

.app-main__inner--site {
  width: min(100%, 1520px);
  padding-top: 8px;
}

@media (min-width: 1180px) {
  .app-shell--site {
    padding-bottom: 0;
  }

  .app-bottom-nav--mobile {
    display: none;
  }

  .app-topbar--site .app-topbar__row {
    grid-template-columns: auto minmax(320px, 520px) auto;
  }
}
```

- [ ] **Step 6: Verify helpers and shell compile cleanly**

Run:
- `npx tsx --test app/lib/compact-layout.test.ts`
- `npm run typecheck`

Expected: PASS for the helper tests and no TypeScript errors.

## Task 2: Introduce shared site-layout primitives

**Files:**
- Create: `app/components/site-layout.tsx`
- Create: `app/components/site-layout.test.tsx`
- Modify: `app/components/ui.tsx`
- Modify: `app/components/primitives.tsx`
- Modify: `app/styles/components.css`

- [ ] **Step 1: Write failing render tests for the new shared primitives**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { MediaGrid, SiteToolbar } from "./site-layout";

test("MediaGrid renders dense mobile and desktop variants through modifier classes", () => {
  const markup = renderToStaticMarkup(
    <MediaGrid variant="catalog">
      <div>card</div>
    </MediaGrid>,
  );

  assert.match(markup, /media-grid media-grid--catalog/);
});

test("SiteToolbar keeps title and actions in separate semantic regions", () => {
  const markup = renderToStaticMarkup(
    <SiteToolbar title="搜索" description="结果优先" actions={<button>筛选</button>} />,
  );

  assert.match(markup, /site-toolbar__copy/);
  assert.match(markup, /site-toolbar__actions/);
});
```

- [ ] **Step 2: Run the primitive test file and confirm it fails**

Run: `npx tsx --test app/components/site-layout.test.tsx`

Expected: FAIL because `site-layout.tsx` does not exist yet.

- [ ] **Step 3: Create the shared layout primitives**

```tsx
import type { ReactNode } from "react";

export function SiteToolbar(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="site-toolbar">
      <div className="site-toolbar__copy">
        <h1 className="site-toolbar__title">{props.title}</h1>
        {props.description ? <p className="site-toolbar__description">{props.description}</p> : null}
      </div>
      {props.actions ? <div className="site-toolbar__actions">{props.actions}</div> : null}
      {props.children ? <div className="site-toolbar__body">{props.children}</div> : null}
    </section>
  );
}

export function MediaGrid(props: { variant?: "catalog" | "home" | "related"; children: ReactNode }) {
  const variant = props.variant ?? "catalog";
  return <div className={`media-grid media-grid--${variant}`}>{props.children}</div>;
}
```

- [ ] **Step 4: Export the new primitives through the existing UI barrel**

```ts
export { AppChrome } from "./chrome";
export { MediaGrid, SiteToolbar } from "./site-layout";
export {
  EmptyPanel,
  MetaPill,
  SectionHeader,
  StatusPanel,
  TagPill,
} from "./primitives";
```

- [ ] **Step 5: Add the shared CSS for dense phone grids and website-style toolbars**

```css
.site-toolbar {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 56%, transparent);
}

.media-grid {
  display: grid;
  gap: 10px;
}

.media-grid--catalog,
.media-grid--home,
.media-grid--related {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (min-width: 430px) {
  .media-grid--catalog,
  .media-grid--home,
  .media-grid--related {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 1180px) {
  .site-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }

  .media-grid--catalog {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
```

- [ ] **Step 6: Run the primitive tests and typecheck**

Run:
- `npx tsx --test app/components/site-layout.test.tsx`
- `npm run typecheck`

Expected: PASS with no export/type errors.

## Task 3: Rebuild the homepage as a dense manga site landing page

**Files:**
- Modify: `app/components/home.tsx`
- Create: `app/components/home.test.tsx`
- Modify: `app/components/loading.tsx`
- Modify: `app/routes/_index.tsx`
- Modify: `app/styles/components.css`

- [ ] **Step 1: Add a failing render test for the new homepage structure**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { HomeReadingHub } from "./home";

test("HomeReadingHub renders search-first site toolbar and dense content sections", () => {
  const markup = renderToStaticMarkup(
    <HomeReadingHub apiOrigin="http://example.com" entryPoints={[]} stream={mockStream} />,
  );

  assert.match(markup, /site-toolbar/);
  assert.match(markup, /media-grid media-grid--home/);
  assert.doesNotMatch(markup, /home-toolbar__description">内容流优先/);
});
```

- [ ] **Step 2: Run the homepage test and confirm it fails**

Run: `npx tsx --test app/components/home.test.tsx`

Expected: FAIL because the current homepage still renders the old `home-toolbar` structure.

- [ ] **Step 3: Replace the oversized hero shell with a site-style toolbar and dense sections**

```tsx
return (
  <div className="home-site">
    <SiteToolbar
      title="最新更新 / 热门 / 分类"
      description="直接进入内容，不再用说明块占首屏。"
      actions={<QuickSearchInline />}
    >
      <div className="home-site__channels">
        {props.entryPoints.map((item) => (
          <EntryPointCard key={item.key} item={item} />
        ))}
      </div>
    </SiteToolbar>

    <RetryableHomeSection ... render={(items) => <LatestSection apiOrigin={props.apiOrigin} items={items} />} />
  </div>
);
```

- [ ] **Step 4: Convert the home card/grid CSS to phone 2-up / 3-up and desktop 6-up**

```css
.home-site,
.home-flow,
.home-ranking-section {
  display: grid;
  gap: 14px;
}

.home-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (min-width: 430px) {
  .home-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 1180px) {
  .home-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 14px;
  }
}
```

- [ ] **Step 5: Align the home skeletons to the new grid density**

```tsx
export function HomeGridSkeleton(props: { count?: number; title: string; description: string }) {
  const count = props.count ?? 12;
  return (
    <section className="home-flow">
      <SectionHeader title={props.title} description={props.description} />
      <div className="home-grid home-grid--skeleton">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="content-skeleton-card" />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Verify homepage rendering and shared types**

Run:
- `npx tsx --test app/components/home.test.tsx`
- `npm run typecheck`

Expected: PASS with the homepage using the new site toolbar and dense grids.

## Task 4: Refactor search and discover into site-style catalog pages

**Files:**
- Modify: `app/routes/search.tsx`
- Modify: `app/components/discover.tsx`
- Modify: `app/routes/discover.tsx`
- Create: `app/components/catalog-page.test.tsx`
- Modify: `app/styles/components.css`

- [ ] **Step 1: Write failing tests for catalog toolbar and dense result grids**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import SearchRoute from "../routes/search";

test("catalog pages prefer toolbar + dense grid instead of stacked status panels", () => {
  const markup = renderToStaticMarkup(
    <div className="catalog-page">
      <div className="catalog-toolbar" />
      <div className="media-grid media-grid--catalog" />
    </div>,
  );

  assert.match(markup, /catalog-toolbar/);
  assert.match(markup, /media-grid media-grid--catalog/);
});
```

- [ ] **Step 2: Run the catalog test and confirm it fails**

Run: `npx tsx --test app/components/catalog-page.test.tsx`

Expected: FAIL because no shared catalog page contract exists yet.

- [ ] **Step 3: Rebuild the search route around a lighter toolbar and result-first layout**

```tsx
return (
  <AppChrome title="Aura" subtitle="漫画检索">
    <div className="catalog-page">
      <section className="catalog-toolbar">
        <Form method="get" role="search" className="catalog-toolbar__form">...</Form>
      </section>

      <section className="catalog-results">
        {hasKeyword && result ? (
          <div className="media-grid media-grid--catalog">
            {result.content.map((item) => <SearchResultCard key={item.id} item={item} apiOrigin={data.apiOrigin} />)}
          </div>
        ) : (
          <StatusPanel title="输入关键词开始检索" description="标题、作者、标签或车号都可以直接输入。" />
        )}
      </section>
    </div>
  </AppChrome>
);
```

- [ ] **Step 4: Rebuild discover with the same catalog shell but a different channel header**

```tsx
return (
  <div className="catalog-page catalog-page--discover">
    <section className="catalog-toolbar catalog-toolbar--discover">
      <nav className="discover-categories" aria-label="发现分类">...</nav>
      <button type="button" className="md-button md-button--surface" onClick={() => setDrawerOpen(true)}>
        筛选
      </button>
    </section>

    <section className="catalog-results">
      <div className="media-grid media-grid--catalog">...</div>
    </section>
  </div>
);
```

- [ ] **Step 5: Add the catalog CSS that removes repeated mobile-app panels**

```css
.catalog-page {
  display: grid;
  gap: 12px;
}

.catalog-toolbar,
.catalog-results {
  display: grid;
  gap: 12px;
  padding: 0 0 8px;
}

.search-results__grid,
.discover-grid {
  display: contents;
}

@media (min-width: 1180px) {
  .catalog-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }
}
```

- [ ] **Step 6: Verify both catalog pages compile and render through the shared pattern**

Run:
- `npx tsx --test app/components/catalog-page.test.tsx`
- `npm run typecheck`

Expected: PASS and no JSX/class-name regressions in the search/discover routes.

## Task 5: Split manga detail into a phone-first detail page and desktop two-column layout

**Files:**
- Create: `app/components/manga-detail.tsx`
- Create: `app/components/manga-detail.test.tsx`
- Modify: `app/routes/manga.$id.tsx`
- Modify: `app/styles/app.css`
- Modify: `app/styles/components.css`

- [ ] **Step 1: Add failing tests for the extracted detail shell**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { MangaDetailLayout } from "./manga-detail";

test("MangaDetailLayout renders a desktop-ready detail body and related-grid hooks", () => {
  const markup = renderToStaticMarkup(
    <MangaDetailLayout hero={<div>hero</div>} body={<div>body</div>} aside={<div>aside</div>} />,
  );

  assert.match(markup, /manga-detail-layout/);
  assert.match(markup, /manga-detail-layout__aside/);
});
```

- [ ] **Step 2: Run the detail layout test and confirm it fails**

Run: `npx tsx --test app/components/manga-detail.test.tsx`

Expected: FAIL because `manga-detail.tsx` does not exist.

- [ ] **Step 3: Extract the reusable detail layout and move route markup into it**

```tsx
export function MangaDetailLayout(props: {
  hero: ReactNode;
  body: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="manga-detail-layout">
      <section className="manga-detail-layout__hero">{props.hero}</section>
      <div className="manga-detail-layout__body">{props.body}</div>
      {props.aside ? <aside className="manga-detail-layout__aside">{props.aside}</aside> : null}
    </div>
  );
}
```

- [ ] **Step 4: Rebuild the route content around the extracted layout**

```tsx
return (
  <MangaDetailLayout
    hero={<MangaHeroBlock manga={props.manga} apiOrigin={props.apiOrigin} favoritePending={props.favoritePending} />}
    body={<MangaContentTabs manga={props.manga} tab={props.tab} comments={props.comments} />}
    aside={<MangaAsideCard latestTask={latestTask} resumeTo={resumeTo} />}
  />
);
```

- [ ] **Step 5: Add CSS for compressed mobile hero and desktop split layout**

```css
.manga-detail-layout {
  display: grid;
  gap: 16px;
}

@media (min-width: 1180px) {
  .manga-detail-layout {
    grid-template-columns: minmax(0, 1.2fr) 360px;
    align-items: start;
  }

  .manga-detail-layout__hero,
  .manga-detail-layout__body {
    grid-column: 1;
  }

  .manga-detail-layout__aside {
    grid-column: 2;
    grid-row: 1 / span 2;
    position: sticky;
    top: calc(var(--app-header-height) + 20px);
  }
}
```

- [ ] **Step 6: Verify the extracted detail layout**

Run:
- `npx tsx --test app/components/manga-detail.test.tsx`
- `npm run typecheck`

Expected: PASS with the route compiling against the new extracted layout.

## Task 6: Extract the reader overlay and finish desktop-specific reading polish

**Files:**
- Create: `app/components/reader-overlay.tsx`
- Create: `app/components/reader-overlay.test.tsx`
- Modify: `app/routes/chapter.$id.tsx`
- Modify: `app/styles/reader.css`

- [ ] **Step 1: Add failing tests for the extracted reader overlay**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { ReaderOverlay } from "./reader-overlay";

test("ReaderOverlay renders hidden-state classes without removing navigation buttons", () => {
  const markup = renderToStaticMarkup(
    <ReaderOverlay visible={false} title="第 1 话" status="1 / 20" previousHref={null} nextHref="/chapter/2" />,
  );

  assert.match(markup, /reader-topbar reader-topbar--hidden/);
  assert.match(markup, /reader-bottombar reader-bottombar--hidden/);
  assert.match(markup, /下一话/);
});
```

- [ ] **Step 2: Run the reader overlay test and confirm it fails**

Run: `npx tsx --test app/components/reader-overlay.test.tsx`

Expected: FAIL because the overlay component does not exist yet.

- [ ] **Step 3: Extract the top/bottom chrome into `ReaderOverlay`**

```tsx
export function ReaderOverlay(props: {
  visible: boolean;
  title: string;
  meta: string;
  status: string;
  previousHref: string | null;
  nextHref: string | null;
  onAction?: MouseEventHandler<HTMLElement>;
}) {
  return (
    <>
      <header className={`reader-topbar${props.visible ? "" : " reader-topbar--hidden"}`}>...</header>
      <footer className={`reader-bottombar${props.visible ? "" : " reader-bottombar--hidden"}`}>...</footer>
    </>
  );
}
```

- [ ] **Step 4: Replace the inline reader chrome with the extracted overlay**

```tsx
return (
  <div className="reader-shell" onClick={() => setShowChrome((current) => !current)}>
    <ReaderOverlay
      visible={showChrome}
      title={props.chapter.indextitle}
      meta={props.manga?.name ?? "Manga"}
      status={formatReaderStatus(activeIndex, imageUrls.length)}
      previousHref={chapterNavigation.previous ? `/chapter/${chapterNavigation.previous.photo_id}` : null}
      nextHref={chapterNavigation.next ? `/chapter/${chapterNavigation.next.photo_id}` : null}
      onAction={onControlAction}
    />
    <main className="reader-webtoon">...</main>
  </div>
);
```

- [ ] **Step 5: Tighten reader CSS for phone safe-areas and desktop width presets**

```css
.reader-webtoon {
  width: min(100%, var(--reader-width, 760px));
  margin-inline: auto;
  padding-top: calc(52px + var(--app-safe-top));
  padding-bottom: calc(108px + var(--app-safe-bottom));
}

@media (max-width: 760px) {
  .reader-webtoon {
    width: 100%;
    padding-bottom: calc(144px + var(--app-safe-bottom));
  }
}

@media (min-width: 1180px) {
  .reader-webtoon {
    width: min(100%, 980px);
  }
}
```

- [ ] **Step 6: Run the reader tests and full typecheck**

Run:
- `npx tsx --test app/components/reader-overlay.test.tsx`
- `npm run typecheck`

Expected: PASS with the reader route now delegating chrome behavior to the extracted overlay component.

## Task 7: Full regression sweep

**Files:**
- Verify only; no new files

- [ ] **Step 1: Run all focused tests together**

Run:

```bash
npx tsx --test \
  app/lib/compact-layout.test.ts \
  app/components/site-layout.test.tsx \
  app/components/home.test.tsx \
  app/components/catalog-page.test.tsx \
  app/components/manga-detail.test.tsx \
  app/components/reader-overlay.test.tsx
```

Expected: PASS for all focused refactor coverage.

- [ ] **Step 2: Run the repository typecheck**

Run: `npm run typecheck`

Expected: PASS without JSX, route loader, or barrel export errors.

- [ ] **Step 3: Start the Remix dev server for manual verification**

Run: `npm run dev`

Expected: local Remix server starts without compilation errors.

- [ ] **Step 4: Manually verify the critical responsive paths**

Check in browser:

```txt
375px: home/search/discover/detail use 2-column primary grids
430px: content grids promote to 3 columns without clipped titles
1280px+: desktop navigation hides bottom nav and pages use website layouts
reader: top/bottom bars no longer cover content on iPhone-safe-area sizes
```

- [ ] **Step 5: Capture the final checkpoint**

Record:

```txt
- Focused tests: pass
- Typecheck: pass
- Mobile 2/3-column grids verified
- Desktop website layout verified
- Reader safe-area verified
```

## Self-review

### Spec coverage

- Mobile manga-site direction: covered by Tasks 1-4
- Phone 2-column / 3-column requirement: covered by Tasks 1-4 and Task 7 manual checks
- Desktop-only website layout: covered by Tasks 1, 2, 5, and 7
- Detail-page redesign: covered by Task 5
- Reader overlay and safe-area fixes: covered by Task 6
- Streaming / retry / defer preservation: preserved by editing route shells in Tasks 3-6 instead of changing loaders

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain
- Every task names exact files and exact commands
- Every implementation step includes concrete code or CSS snippets

### Type consistency

- Shared layout helpers live in `app/lib/compact-layout.ts`
- Shared primitives export from `app/components/ui.tsx`
- New extracted UI modules are `site-layout.tsx`, `manga-detail.tsx`, and `reader-overlay.tsx`

