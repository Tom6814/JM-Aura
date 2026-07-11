# Desktop Manga Hero Cover Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 电脑端详情页 hero 在中等桌面/大屏两档放大封面以减少右侧留白，并在桌面端将标题限制为最多 3 行后省略。

**Architecture:** 纯 CSS 分断点调整 `manga-detail-layout__hero` 列宽与封面元素拉伸策略；标题使用 CSS 多行截断（`-webkit-line-clamp`）限制 3 行。避免 JS 测量，保持高性能与稳定。

**Tech Stack:** Remix + React、CSS（`app/styles/app.css`）、Node test runner（tsx tests）、TypeScript（tsc）。

---

## Files to change

- Modify: `app/styles/app.css`
- (Optional) Modify: `app/routes/manga.$id.tsx`（仅当需要额外 class hook；当前已有 `manga-detail-layout__cover-artwork`）
- Test: `app/components/manga-detail.test.tsx`（结构不变时无需改；仅回归运行）
- Docs: `docs/superpowers/specs/2026-07-10-desktop-hero-cover-scaling-design.md`（已完成）

---

### Task 1: 桌面端封面两档放大

**Files:**
- Modify: `app/styles/app.css`

- [ ] **Step 1: 写下当前断点与目标数值**

目标（建议起点，最终可微调）：

- `@media (min-width: 720px)`：封面列从 `minmax(148px, 168px)` → `minmax(180px, 220px)`
- `@media (min-width: 1180px)`：封面列从 `minmax(168px, 196px)` → `minmax(220px, 260px)`

保留 hero 的 `padding`，保证“留缝”仍存在。

- [ ] **Step 2: 修改 `720px+` 的 hero 列宽**

在 `app/styles/app.css` 的 `@media (min-width: 720px)` 区块里，找到：

```css
.manga-detail-layout__hero {
  grid-template-columns: minmax(148px, 168px) minmax(0, 1fr);
}
```

替换为：

```css
.manga-detail-layout__hero {
  grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
}
```

- [ ] **Step 3: 修改 `1180px+` 的 hero 列宽**

在 `app/styles/app.css` 的 `@media (min-width: 1180px)` 区块里，找到：

```css
.manga-detail-layout__hero {
  grid-template-columns: minmax(168px, 196px) minmax(0, 1fr) minmax(240px, 280px);
}
```

替换为：

```css
.manga-detail-layout__hero {
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(240px, 280px);
}
```

> 注：如果当前页面没有右侧辅助区（第三列），这条规则不会生效；那是预期行为。本次只做“有右侧留白时放大”的感受，主要发生在三列布局场景。

- [ ] **Step 4: 让封面在桌面端“更接近 hero 高度”（视觉贴齐）**

在同一个 `@media (min-width: 1180px)` 区块中增加（或调整）以下规则：

```css
.manga-detail-layout__cover {
  align-self: stretch;
}

.manga-detail-layout__cover-artwork {
  height: 100%;
  width: auto;
  max-width: 100%;
}
```

说明：
- `height: 100%` + `width: auto` 会让封面尽量按高度贴齐右侧信息块（视觉上更“满”）
- `max-width: 100%` 防止横向溢出
- 依赖 `aspect-ratio` 时不同浏览器会有细微差异，可在验收中微调到“更像 JM-Aura”的观感

- [ ] **Step 5: 回归检查（无需新增自动化测试）**

运行：

1. `npx tsx --test app/components/manga-detail.test.tsx`
2. `npm run typecheck`

预期：全部 PASS。

- [ ] **Step 6: 手动验收**

在浏览器中打开一部标题较短的作品详情页：

1. 宽度约 `1000px`（或缩放到 `>=720px`）：封面比之前更大，但不压迫标题/按钮
2. 宽度约 `1400px`（或缩放到 `>=1180px`）：封面明显更大，右侧留白显著减少
3. 封面四周仍保留 hero 的内边距“留缝”

- [ ] **Step 7: Commit**

```bash
git add app/styles/app.css
git commit -m "style: scale manga hero cover on desktop breakpoints"
```

---

### Task 2: 桌面端标题最多 3 行

**Files:**
- Modify: `app/styles/app.css`

- [ ] **Step 1: 只在桌面端启用 3 行截断**

在 `app/styles/app.css` 中找到 `.manga-detail-layout__title`（基础样式定义处），不要在基础样式直接截断（避免影响手机端）。

在 `@media (min-width: 720px)` 中追加：

```css
.manga-detail-layout__title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
```

如果桌面端已有类似截断规则，改为 `-webkit-line-clamp: 3` 并确保只在桌面断点生效。

- [ ] **Step 2: 手动验收（长标题）**

打开一部标题很长的作品（确保能超过 3 行）：

1. `>=720px`：标题最多 3 行并省略
2. 手机宽度：保持当前更宽容的标题展示（不强制 3 行）

- [ ] **Step 3: 回归检查**

运行：

1. `npx tsx --test app/components/manga-detail.test.tsx`
2. `npm run typecheck`

预期：全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add app/styles/app.css
git commit -m "style: clamp manga hero title to 3 lines on desktop"
```

---

## Plan self-review

- [ ] Spec 覆盖检查：两档封面放大 + 桌面端标题 3 行截断均对应 Task 1/2。
- [ ] 占位符扫描：无 TBD/TODO。
- [ ] 类型一致性：仅 CSS 变更，不引入 TS 新类型。

---

## Execution choice

Plan complete and saved to `docs/superpowers/plans/2026-07-10-desktop-hero-cover-scaling.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
