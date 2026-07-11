import { useState } from "react";
import { Form, Link, useFetcher } from "@remix-run/react";
import type { ReactNode } from "react";

import type { CategoryResult } from "../../../packages/shared/src/schema";
import { FilterDrawer } from "../components/filter-drawer";
import { buildPassthroughImageUrl } from "../lib/jm-media";
import {
  buildDiscoverHref,
  DEFAULT_DISCOVER_QUERY,
  DISCOVER_CATEGORY_OPTIONS,
  DISCOVER_ORDER_OPTIONS,
  DISCOVER_TIME_OPTIONS,
  getDiscoverSubCategorySuggestions,
  type DiscoverQuery,
} from "../lib/discover-query";
import {
  CoverArtwork,
  DocumentNavigationLink,
  MediaGrid,
  MetaPill,
  SectionHeader,
  SiteToolbar,
  StatusPanel,
  TagPill,
} from "./ui";

type DiscoverExplorerProps = {
  apiOrigin: string;
  query: Omit<DiscoverQuery, "sub_category"> & { sub_category?: string };
  result: CategoryResult | null;
  error: string | null;
  loading?: boolean;
};

export function DiscoverExplorer(props: DiscoverExplorerProps) {
  const query: DiscoverQuery = {
    ...DEFAULT_DISCOVER_QUERY,
    ...props.query,
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
  const fetcher = useFetcher<{ result: CategoryResult | null; error: string | null }>();
  const categoryLabel = getCategoryLabel(query.category);
  const subCategorySuggestions = mergeSubCategorySuggestions(
    query.sub_category,
    getDiscoverSubCategorySuggestions(query.category),
  );
  const retrying = fetcher.state !== "idle";
  const resolvedResult = fetcher.data?.result ?? props.result;
  const resolvedError = fetcher.data?.error ?? props.error;
  const loading = props.loading || retrying;
  const retryHref = buildDiscoverRetryHref(query);

  return (
    <CatalogPage
      results={
        loading ? (
          <CatalogResultsPanel
            eyebrow="内容"
            title="正在刷新发现流"
            description="分类轨道先显示，内容列表稍后填充。"
          >
            <MediaGrid variant="directory" className="catalog-grid media-grid--skeleton" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className="content-skeleton-card" />
              ))}
            </MediaGrid>
          </CatalogResultsPanel>
        ) : resolvedError ? (
          <CatalogResultsPanel
            eyebrow="内容"
            title="发现流暂时不可用"
            description="当前区块没有同步成功。"
          >
            <StatusPanel
              tone="error"
              title="发现流暂时不可用"
              description={resolvedError}
              action={
                <div className="compact-actions">
                  <button
                    type="button"
                    className="md-button md-button--primary"
                    onClick={() => fetcher.load(retryHref)}
                    disabled={retrying}
                  >
                    {retrying ? "重试中..." : "重试当前区块"}
                  </button>
                  <Link className="md-button md-button--surface" prefetch="intent" to="/discover">
                    返回默认发现流
                  </Link>
                </div>
              }
            />
          </CatalogResultsPanel>
        ) : resolvedResult && resolvedResult.content.length > 0 ? (
          <CatalogResultsPanel
            eyebrow="内容"
            title={`共找到 ${resolvedResult.total} 部作品`}
            description={`第 ${query.page} 页`}
          >
            <MediaGrid variant="directory" className="catalog-grid">
              {resolvedResult.content.map((item) => (
                <CatalogMediaCard
                  key={item.id}
                  apiOrigin={props.apiOrigin}
                  item={item}
                />
              ))}
            </MediaGrid>

            <DiscoverPagination page={query.page} pageCount={resolvedResult.page_count} query={query} />
          </CatalogResultsPanel>
        ) : (
          <CatalogResultsPanel
            eyebrow="内容"
            title="当前发现条件下还没有内容"
            description="可以切换分类、清空子分类，或回到搜索页做更明确的检索。"
          >
            <StatusPanel
              title="当前发现条件下还没有内容"
              description="可以切换分类、清空子分类，或回到搜索页做更明确的检索。"
              action={
                <Link className="md-button md-button--primary" prefetch="intent" to="/search">
                  去搜索
                </Link>
              }
            />
          </CatalogResultsPanel>
        )
      }
      toolbar={
        <CatalogToolbar
          eyebrow="发现"
          title={categoryLabel}
          description={resolvedError ? "当前已回退到分类浏览骨架。" : "筛选与分类保持在同一目录工具栏中。"}
          aside={
            <div className="catalog-toolbar__actions">
              <button
                type="button"
                className="md-button md-button--surface"
                onClick={() => setDrawerOpen(true)}
              >
                筛选
              </button>
              <Link className="md-button md-button--outlined" prefetch="intent" to="/search">
                去搜索
              </Link>
            </div>
          }
        >
          <nav className="discover-categories" aria-label="发现分类">
            {DISCOVER_CATEGORY_OPTIONS.map((option) => {
              const isActive = option.value === query.category;

              return (
                <Link
                  key={option.value || "all"}
                  className={`discover-category-chip${isActive ? " discover-category-chip--active" : ""}`}
                  prefetch="intent"
                  to={buildDiscoverHref(
                    {
                      category: option.value,
                      sub_category: undefined,
                      page: 1,
                    },
                    query,
                  )}
                >
                  {option.label}
                </Link>
              );
            })}
          </nav>

          <div className="compact-meta-row">
            {query.sub_category ? <MetaPill label="子分类" value={query.sub_category} /> : null}
            <MetaPill label="排序" value={getOrderLabel(query.order_by)} />
            <MetaPill label="时间" value={getTimeLabel(query.time)} />
            <MetaPill label="页码" value={`第 ${query.page} 页`} />
          </div>
        </CatalogToolbar>
      }
    >
      <FilterDrawer title="发现筛选" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Form method="get" className="discover-drawer__form">
          {query.category ? <input type="hidden" name="category" value={query.category} /> : null}

          <div className="discover-drawer__fields">
            <label className="compact-field">
              <span className="compact-field__label">子分类</span>
              <input
                className="md-select"
                name="sub_category"
                type="text"
                defaultValue={query.sub_category ?? ""}
                placeholder={query.category ? "如 CG、Cosplay、3D…" : "先选择分类"}
                disabled={query.category.length === 0}
              />
            </label>

            <label className="compact-field">
              <span className="compact-field__label">排序方式</span>
              <select className="md-select" name="order_by" defaultValue={query.order_by}>
                {DISCOVER_ORDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="compact-field">
              <span className="compact-field__label">时间范围</span>
              <select className="md-select" name="time" defaultValue={query.time}>
                {DISCOVER_TIME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {subCategorySuggestions.length > 0 ? (
            <div className="discover-drawer__suggestions">
              {subCategorySuggestions.map((subCategory) => {
                const isActive = subCategory === query.sub_category;

                return (
                  <Link
                    key={subCategory}
                    className={isActive ? "md-button md-button--primary" : "md-button md-button--surface"}
                    prefetch="intent"
                    to={buildDiscoverHref({ sub_category: subCategory, page: 1 }, query)}
                    onClick={() => setDrawerOpen(false)}
                  >
                    {subCategory}
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="discover-drawer__hint">当前分类暂无预置子分类建议。</p>
          )}

          <div className="compact-actions">
            <button
              className="md-button md-button--primary"
              type="submit"
              onClick={() => setDrawerOpen(false)}
            >
              应用筛选
            </button>
            {query.sub_category ? (
              <Link
                className="md-button md-button--outlined"
                prefetch="intent"
                to={buildDiscoverHref({ sub_category: undefined, page: 1 }, query)}
                onClick={() => setDrawerOpen(false)}
              >
                清除子分类
              </Link>
            ) : null}
            <Link
              className="md-button md-button--surface"
              prefetch="intent"
              to={buildDiscoverHref({ page: 1 }, query)}
              onClick={() => setDrawerOpen(false)}
            >
              刷新当前条件
            </Link>
          </div>
        </Form>
      </FilterDrawer>
    </CatalogPage>
  );
}

export function CatalogPage(props: {
  results: ReactNode;
  toolbar: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`catalog-page${props.className ? ` ${props.className}` : ""}`}>
      {props.toolbar}
      <div className="catalog-page__results">{props.results}</div>
      {props.children}
    </div>
  );
}

export function CatalogToolbar(props: {
  eyebrow?: string;
  title: string;
  description?: string;
  aside?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <SiteToolbar
      eyebrow={props.eyebrow}
      title={props.title}
      description={props.description}
      aside={props.aside}
      className={`catalog-toolbar${props.className ? ` ${props.className}` : ""}`}
    >
      {props.children}
    </SiteToolbar>
  );
}

function CatalogResultsPanel(props: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="catalog-results">
      <SectionHeader eyebrow={props.eyebrow} title={props.title} description={props.description} />
      {props.children}
    </section>
  );
}

function CatalogMediaCard(props: {
  apiOrigin: string;
  item: CategoryResult["content"][number];
}) {
  return (
    <DocumentNavigationLink key={props.item.id} className="md-card catalog-card" to={`/manga/${props.item.id}`}>
      <div className="md-card__media">
        <CoverArtwork
          src={props.item.image ? buildPassthroughImageUrl(props.apiOrigin, props.item.image, "webp") : null}
          title={props.item.name}
          aspectRatio="3/4"
          size="compact"
        />
      </div>
      <div className="md-card__content">
        <h3 className="md-card__title">{props.item.name}</h3>
        <p className="md-card__supporting-text">{props.item.author ?? "未知作者"}</p>
        <div className="catalog-card__tags">
          {props.item.tags.slice(0, 2).map((tag) => <TagPill key={tag}>{tag}</TagPill>)}
        </div>
      </div>
    </DocumentNavigationLink>
  );
}

function buildDiscoverRetryHref(query: DiscoverQuery) {
  const href = buildDiscoverHref({}, query);
  return `${href}&discover-retry=content&nonce=${Date.now()}`;
}

function DiscoverPagination(props: {
  page: number;
  pageCount: number;
  query: DiscoverQuery;
}) {
  if (props.pageCount <= 1) {
    return null;
  }

  return (
    <div className="catalog-pagination">
      {props.page > 1 ? (
        <Link className="md-button md-button--surface" prefetch="intent" to={buildDiscoverHref({ page: props.page - 1 }, props.query)}>
          上一页
        </Link>
      ) : null}
      <MetaPill label="分页" value={`${props.page} / ${props.pageCount}`} />
      {props.page < props.pageCount ? (
        <Link className="md-button md-button--surface" prefetch="intent" to={buildDiscoverHref({ page: props.page + 1 }, props.query)}>
          下一页
        </Link>
      ) : null}
    </div>
  );
}

function getCategoryLabel(category: DiscoverQuery["category"]) {
  return DISCOVER_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? "全部";
}

function getOrderLabel(orderBy: DiscoverQuery["order_by"]) {
  return DISCOVER_ORDER_OPTIONS.find((option) => option.value === orderBy)?.label ?? "最多观看";
}

function getTimeLabel(time: DiscoverQuery["time"]) {
  return DISCOVER_TIME_OPTIONS.find((option) => option.value === time)?.label ?? "全部时间";
}

function mergeSubCategorySuggestions(current: string | undefined, suggestions: readonly string[]) {
  if (!current) {
    return [...suggestions];
  }

  return suggestions.includes(current) ? [...suggestions] : [current, ...suggestions];
}
