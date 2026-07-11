import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import type { FavoritesResult, FavoriteItem } from "../../../packages/shared/src/schema";
import { CoverArtwork, DocumentNavigationLink, MediaGrid, SectionHeader, StatusPanel } from "../components/ui";
import { buildPassthroughImageUrl } from "../lib/jm-media";
import { fetchFavorites, getApiOrigin } from "../lib/jm-rpc.server";
import { getFavoritesPageSize } from "../lib/me-settings.server";
import { hasRequestCookie } from "../lib/request-cookie";

export const meFavoritesLoaderDependencies = {
  fetchFavorites,
  getApiOrigin,
  getFavoritesPageSize,
  hasRequestCookie,
};

type FavoritesPageData = {
  apiOrigin: string;
  isLoggedIn: boolean;
  folderId: string;
  page: number;
  pageSize: number;
  favorites: FavoritesResult | null;
};

export const meta: MetaFunction = () => [{ title: "收藏夹 | JM Aura Remix" }];

function normalizePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const folderId = (url.searchParams.get("folder") ?? "0").trim() || "0";
  const page = normalizePositiveInt(url.searchParams.get("page"), 1);
  const pageSize = await meFavoritesLoaderDependencies.getFavoritesPageSize(request);
  const apiOrigin = meFavoritesLoaderDependencies.getApiOrigin(request);

  const hasSession = meFavoritesLoaderDependencies.hasRequestCookie(request.headers.get("Cookie"), "aura_session");
  if (!hasSession) {
    return json({
      apiOrigin,
      isLoggedIn: false,
      folderId,
      page,
      pageSize,
      favorites: null,
    } satisfies FavoritesPageData);
  }

  return json({
    apiOrigin,
    isLoggedIn: true,
    folderId,
    page,
    pageSize,
    favorites: await meFavoritesLoaderDependencies.fetchFavorites(request, {
      page,
      folder_id: folderId,
      order_by: "mr",
      page_size: pageSize,
    }).catch(() => null),
  } satisfies FavoritesPageData);
}

export async function action({ request }: ActionFunctionArgs) {
  // 当前阶段：收藏页不处理表单动作，所有登录/设置都在 /me
  const url = new URL(request.url);
  return redirect(url.pathname + url.search);
}

export default function MeFavoritesRoute() {
  const data = useLoaderData<typeof loader>() as unknown as FavoritesPageData;

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader
        eyebrow="我的"
        title="收藏夹"
        description={`每页 ${data.pageSize} 条`}
        action={
          <DocumentNavigationLink className="md-button md-button--surface" to="/me">
            设置
          </DocumentNavigationLink>
        }
      />

      {!data.isLoggedIn ? (
        <StatusPanel
          title="登录后可查看收藏夹"
          description="当前会话还没有登录信息，请先去“我的-设置”页登录。"
          action={
            <DocumentNavigationLink className="md-button md-button--primary" to="/me">
              去登录
            </DocumentNavigationLink>
          }
        />
      ) : data.favorites ? (
        <FavoritesLayout
          apiOrigin={data.apiOrigin}
          currentFolderId={data.folderId}
          currentPage={data.page}
          favorites={data.favorites}
        />
      ) : (
        <StatusPanel
          title="收藏夹暂时不可用"
          description="可能是登录已过期或接口暂时不可用。可以回到设置页重新登录。"
          action={
            <DocumentNavigationLink className="md-button md-button--primary" to="/me">
              回到设置页
            </DocumentNavigationLink>
          }
        />
      )}
    </div>
  );
}

function FavoritesLayout(props: {
  apiOrigin: string;
  favorites: FavoritesResult;
  currentFolderId: string;
  currentPage: number;
}) {
  const folders = props.favorites.folder_list;
  const folderLinks = (
    <nav className="me-favorites__folders" aria-label="收藏夹文件夹">
      {folders.map((folder) => {
        const active = folder.FID === props.currentFolderId;
        const href = `/me/favorites?folder=${encodeURIComponent(folder.FID)}&page=1`;
        return (
          <DocumentNavigationLink
            key={folder.FID}
            className={`me-folder-pill${active ? " me-folder-pill--active" : ""}`}
            to={href}
          >
            {folder.name}
          </DocumentNavigationLink>
        );
      })}
    </nav>
  );

  return (
    <section className="me-favorites">
      <div className="me-favorites__sidebar">
        <SectionHeader
          eyebrow="文件夹"
          title="收藏夹目录"
          description={`${props.favorites.total} 项`}
        />
        {folderLinks}
      </div>

      <div className="me-favorites__main">
        <SectionHeader
          eyebrow="列表"
          title={`第 ${props.currentPage} 页`}
          description={`共 ${props.favorites.page_count} 页`}
        />

        {props.favorites.list.length > 0 ? (
          <MediaGrid className="media-grid--home">
            {props.favorites.list.map((item) => (
              <FavoriteMangaCard key={item.id} apiOrigin={props.apiOrigin} item={item} />
            ))}
          </MediaGrid>
        ) : (
          <StatusPanel title="这个文件夹还没有收藏" description="可以去首页/搜索里添加一些作品收藏。" />
        )}

        <MeFavoritesPagination
          currentFolderId={props.currentFolderId}
          page={props.currentPage}
          pageCount={props.favorites.page_count}
        />
      </div>
    </section>
  );
}

function FavoriteMangaCard(props: { apiOrigin: string; item: FavoriteItem }) {
  const coverUrl =
    props.item.image != null
      ? buildPassthroughImageUrl(props.apiOrigin, props.item.image, "webp")
      : null;

  return (
    <DocumentNavigationLink className="home-card" to={`/manga/${props.item.id}`}>
      <div className="home-card__media">
        <CoverArtwork src={coverUrl} title={props.item.name} aspectRatio="3/4" size="compact" />
      </div>
      <div className="home-card__content">
        <h3 className="home-card__title">{props.item.name}</h3>
        <p className="home-card__meta">
          {props.item.author ?? "未知作者"}
          {props.item.latest_ep ? ` · 最新：${props.item.latest_ep}` : ""}
        </p>
      </div>
    </DocumentNavigationLink>
  );
}

function MeFavoritesPagination(props: {
  currentFolderId: string;
  page: number;
  pageCount: number;
}) {
  if (props.pageCount <= 1) return null;
  const prevPage = Math.max(1, props.page - 1);
  const nextPage = Math.min(props.pageCount, props.page + 1);

  return (
    <nav className="me-pagination" aria-label="收藏夹分页">
      <DocumentNavigationLink
        className="md-button md-button--surface"
        to={`/me/favorites?folder=${encodeURIComponent(props.currentFolderId)}&page=${prevPage}`}
        aria-disabled={props.page <= 1}
      >
        上一页
      </DocumentNavigationLink>
      <span className="me-pagination__meta">{`第 ${props.page} / ${props.pageCount} 页`}</span>
      <DocumentNavigationLink
        className="md-button md-button--surface"
        to={`/me/favorites?folder=${encodeURIComponent(props.currentFolderId)}&page=${nextPage}`}
        aria-disabled={props.page >= props.pageCount}
      >
        下一页
      </DocumentNavigationLink>
    </nav>
  );
}
