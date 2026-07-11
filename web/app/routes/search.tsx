import { type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";

import type { SearchMainTag, SearchResultItem } from "../../../packages/shared/src/schema";
import { CatalogPage, CatalogToolbar } from "../components/discover";
import { FilterDrawer } from "../components/filter-drawer";
import { buildPassthroughImageUrl } from "../lib/jm-media";
import { parseSearchParams } from "../lib/search-query";
import { getApiOrigin, searchManga } from "../lib/jm-rpc.server";
import {
  AppChrome,
  CoverArtwork,
  DocumentNavigationLink,
  MediaGrid,
  MetaPill,
  SectionHeader,
  StatusPanel,
  TagPill,
} from "../components/ui";

export const meta: MetaFunction = () => {
  return [{ title: "漫画搜索 | JM Aura Remix" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const { keyword, page, main_tag, order_by, time } = parseSearchParams(url.searchParams);
  const apiOrigin = getApiOrigin(request);
  let result = null;
  let error: string | null = null;

  if (keyword.length > 0) {
    try {
      result = await searchManga(request, { keyword, page, main_tag, order_by, time });
    } catch (searchError) {
      error = searchError instanceof Error ? searchError.message : "搜索服务暂时不可用";
    }
  }

  return {
    apiOrigin,
    keyword,
    page,
    main_tag,
    order_by,
    time,
    result,
    error,
  };
}

export default function SearchRoute() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSearching = navigation.location?.pathname === "/search" && navigation.state !== "idle";

  return (
    <AppChrome>
      <SearchCatalogPage data={data} isSearching={isSearching} />
    </AppChrome>
  );
}

export function SearchCatalogPage(props: {
  data: Awaited<ReturnType<typeof loader>>;
  isSearching: boolean;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const result = props.data.result;
  const hasKeyword = props.data.keyword.length > 0;

  return (
    <CatalogPage
      className="catalog-page--search"
      results={
        <section className="catalog-results">
          <SectionHeader
            eyebrow="结果"
            title={hasKeyword ? `“${props.data.keyword}”的结果` : "等待搜索"}
            description={hasKeyword ? `第 ${props.data.page} 页` : "输入关键词后开始检索。"}
          />

          {props.isSearching ? (
            <StatusPanel
              tone="accent"
              title="正在更新检索结果"
              description="保留当前结果，等待新的 URL 参数返回。"
            />
          ) : null}

          {props.data.error !== null ? (
            <StatusPanel
              tone="error"
              title="搜索链路暂时不可用"
              description={props.data.error}
              action={
                <Link className="md-button md-button--surface" prefetch="intent" to="/search">
                  返回空搜索页
                </Link>
              }
            />
          ) : !hasKeyword ? (
            <StatusPanel
              title="输入关键词开始检索"
              description="标题、作者、标签或车号都可以直接输入。"
            />
          ) : result !== null && result.content.length === 0 ? (
            <StatusPanel
              title="未找到相关结果"
              description={`关键词「${props.data.keyword}」暂无搜索结果。`}
            />
          ) : result !== null ? (
            <SearchResultsSection
              apiOrigin={props.data.apiOrigin}
              keyword={props.data.keyword}
              page={props.data.page}
              pageCount={result.page_count}
              main_tag={props.data.main_tag}
              order_by={props.data.order_by}
              time={props.data.time}
              items={result.content}
              isSingleAlbum={result.is_single_album}
              singleAlbumId={result.single_album?.album_id ?? null}
            />
          ) : null}
        </section>
      }
      toolbar={
        <CatalogToolbar
          eyebrow="搜索"
          title={hasKeyword ? props.data.keyword : "目录检索"}
          description={
            hasKeyword
              ? "搜索条件与目录结果分区显示，避免重复大面板。"
              : "关键词、排序与时间范围统一收在目录工具栏。"
          }
          aside={
            <div className="catalog-toolbar__actions">
              <button
                className="md-button md-button--surface catalog-filter-button"
                type="button"
                onClick={() => setFilterOpen(true)}
              >
                筛选
              </button>
            </div>
          }
        >
          <Form reloadDocument method="get" role="search" className="catalog-search-form">
            <div className="md-search-bar catalog-search-form__input">
              <span className="material-symbols-rounded" aria-hidden="true">
                search
              </span>
              <input
                className="md-search-bar__input"
                type="search"
                name="q"
                defaultValue={props.data.keyword}
                placeholder="搜索标题、作者、标签或 ID…"
                aria-label="搜索标题、作者、标签或 ID"
              />
            </div>
            <button className="md-button md-button--primary" type="submit">
              {props.isSearching ? "搜索中…" : "搜索"}
            </button>
          </Form>

          <div className="compact-meta-row">
            <MetaPill label="范围" value={getScopeLabel(props.data.main_tag)} />
            <MetaPill label="排序" value={getOrderLabel(props.data.order_by)} />
            <MetaPill label="时间" value={getTimeLabel(props.data.time)} />
            {hasKeyword ? <MetaPill label="页码" value={`第 ${props.data.page} 页`} /> : null}
          </div>
        </CatalogToolbar>
      }
    >
      <FilterDrawer title="搜索筛选" open={filterOpen} onClose={() => setFilterOpen(false)}>
        <Form reloadDocument method="get" role="search" className="discover-drawer__form">
          <input type="hidden" name="q" value={props.data.keyword} />

          <div className="search-drawer__fields">
            <label className="compact-field">
              <span className="compact-field__label">搜索范围</span>
              <select name="main_tag" defaultValue={String(props.data.main_tag)} className="md-select">
                {SEARCH_SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="compact-field">
              <span className="compact-field__label">排序方式</span>
              <select name="order_by" defaultValue={props.data.order_by} className="md-select">
                {ORDER_BY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="compact-field">
              <span className="compact-field__label">时间范围</span>
              <select name="time" defaultValue={props.data.time} className="md-select">
                {TIME_RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="compact-actions">
            <button className="md-button md-button--primary" type="submit" onClick={() => setFilterOpen(false)}>
              应用筛选
            </button>
            <Link className="md-button md-button--surface" prefetch="intent" to="/search" onClick={() => setFilterOpen(false)}>
              重置
            </Link>
          </div>
        </Form>
      </FilterDrawer>
    </CatalogPage>
  );
}

function SearchResultsSection(props: {
  apiOrigin: string;
  keyword: string;
  page: number;
  pageCount: number;
  main_tag: SearchMainTag;
  order_by: (typeof ORDER_BY_OPTIONS)[number]["value"];
  time: (typeof TIME_RANGE_OPTIONS)[number]["value"];
  items: SearchResultItem[];
  isSingleAlbum: boolean;
  singleAlbumId: string | null;
}) {
  return (
    <div className="search-results__content">
      {props.isSingleAlbum && props.singleAlbumId !== null ? (
        <StatusPanel
          tone="accent"
          title="已找到唯一结果，可直接进入详情页"
          description="当前结果会继续保留，方便对照浏览。"
          action={
            <DocumentNavigationLink className="md-button md-button--primary" to={`/manga/${props.singleAlbumId}`}>
              直达详情
            </DocumentNavigationLink>
          }
        />
      ) : null}

      <MediaGrid variant="directory" className="catalog-grid">
        {props.items.map((item) => (
          <SearchResultCard key={item.id} apiOrigin={props.apiOrigin} item={item} />
        ))}
      </MediaGrid>

      <PaginationControls
        keyword={props.keyword}
        page={props.page}
        pageCount={props.pageCount}
        main_tag={props.main_tag}
        order_by={props.order_by}
        time={props.time}
      />
    </div>
  );
}

function SearchResultCard(props: {
  apiOrigin: string;
  item: SearchResultItem;
}) {
  return (
    <DocumentNavigationLink key={props.item.id} to={`/manga/${props.item.id}`} className="md-card catalog-card">
      <div className="md-card__media">
        <CoverArtwork
          src={props.item.image === null ? null : buildPassthroughImageUrl(props.apiOrigin, props.item.image, "webp")}
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

function PaginationControls(props: {
  keyword: string;
  page: number;
  pageCount: number;
  main_tag: SearchMainTag;
  order_by: (typeof ORDER_BY_OPTIONS)[number]["value"];
  time: (typeof TIME_RANGE_OPTIONS)[number]["value"];
}) {
  if (props.pageCount <= 1) {
    return null;
  }

  return (
    <div className="catalog-pagination">
      {props.page > 1 ? (
        <Link className="md-button md-button--surface" prefetch="intent" to={buildSearchHref(props.keyword, props.page - 1, props.main_tag, props.order_by, props.time)}>
          上一页
        </Link>
      ) : null}
      <MetaPill label="分页" value={`${props.page} / ${props.pageCount}`} />
      {props.page < props.pageCount ? (
        <Link className="md-button md-button--surface" prefetch="intent" to={buildSearchHref(props.keyword, props.page + 1, props.main_tag, props.order_by, props.time)}>
          下一页
        </Link>
      ) : null}
    </div>
  );
}

const SEARCH_SCOPE_OPTIONS: Array<{ value: SearchMainTag; label: string }> = [
  { value: 0, label: "站内" },
  { value: 1, label: "作品" },
  { value: 2, label: "作者" },
  { value: 3, label: "标签" },
  { value: 4, label: "角色" },
];

const ORDER_BY_OPTIONS = [
  { value: "mr", label: "最新" },
  { value: "mv", label: "最多观看" },
  { value: "mp", label: "最多图片" },
  { value: "tf", label: "最多收藏" },
] as const;

const TIME_RANGE_OPTIONS = [
  { value: "a", label: "全部时间" },
  { value: "t", label: "今天" },
  { value: "w", label: "本周" },
  { value: "m", label: "本月" },
] as const;

function buildSearchHref(
  keyword: string,
  page: number,
  main_tag: SearchMainTag,
  order_by: (typeof ORDER_BY_OPTIONS)[number]["value"],
  time: (typeof TIME_RANGE_OPTIONS)[number]["value"],
) {
  const params = new URLSearchParams({
    q: keyword,
    page: String(page),
    main_tag: String(main_tag),
    order_by,
    time,
  });

  return `/search?${params.toString()}`;
}

function getScopeLabel(mainTag: SearchMainTag) {
  return SEARCH_SCOPE_OPTIONS.find((option) => option.value === mainTag)?.label ?? "站内";
}

function getOrderLabel(orderBy: (typeof ORDER_BY_OPTIONS)[number]["value"]) {
  return ORDER_BY_OPTIONS.find((option) => option.value === orderBy)?.label ?? "最新";
}

function getTimeLabel(time: (typeof TIME_RANGE_OPTIONS)[number]["value"]) {
  return TIME_RANGE_OPTIONS.find((option) => option.value === time)?.label ?? "全部时间";
}
