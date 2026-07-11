import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useActionData, useFetcher, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CommentsResult, FavoriteFolder, Manga } from "../../../packages/shared/src/schema";
import {
  AppChrome,
  CoverArtwork,
  DocumentNavigationLink,
  EmptyPanel,
  MetaPill,
  SectionHeader,
  StatusPanel,
  TagPill,
} from "../components/ui";
import { DownloadChapterPicker, FavoriteFolderPicker, MangaDetailLayout } from "../components/manga-detail";
import {
  getCommentMetaLabels,
} from "../lib/comment-meta";
import {
  getMangaDetailQueryLinkProps,
} from "../lib/manga-detail-link-props";
import {
  parseMangaDetailView,
  shouldSkipMangaDetailRevalidation,
} from "../lib/manga-detail-navigation";
import { buildPassthroughImageUrl } from "../lib/jm-media";
import {
  addFavorite,
  createAlbumExportTask,
  fetchComments,
  fetchManga,
  fetchTaskList,
  getApiOrigin,
  type TaskSummary,
} from "../lib/jm-rpc.server";
import {
  readStoredReadingState,
  resolveResumeChapterId,
} from "../lib/reading-state";
import {
  formatTaskStatusLabel,
  formatTaskSummary,
  mapTaskStatusTone,
} from "../lib/tasks";

export const mangaDetailRouteDependencies = {
  addFavorite,
};

export const mangaDetailActionDependencies = {
  createAlbumExportTask,
};

export function parseSelectedChaptersFromFormData(formData: FormData) {
  return formData
    .getAll("selected_chapters")
    .map((value) => {
      try {
        const parsed = JSON.parse(String(value));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as { chapterId?: unknown }).chapterId === "string"
        ) {
          return {
            chapterId: String((parsed as { chapterId: string }).chapterId),
            chapterTitle:
              typeof (parsed as { chapterTitle?: unknown }).chapterTitle === "string"
                ? String((parsed as { chapterTitle: string }).chapterTitle)
                : null,
            chapterSort:
              typeof (parsed as { chapterSort?: unknown }).chapterSort === "string"
                ? String((parsed as { chapterSort: string }).chapterSort)
                : null,
          };
        }
      } catch {
        return null;
      }
      return null;
    })
    .filter((chapter): chapter is {
      chapterId: string;
      chapterTitle: string | null;
      chapterSort: string | null;
    } => chapter !== null);
}

export const mangaDetailLoaderDependencies = {
  fetchComments,
  fetchManga,
  fetchTaskList,
  getApiOrigin,
};

export function shouldAutoCloseFavoritePicker(
  actionData:
    | {
        intent: string;
        ok: boolean;
        message: string;
      }
    | undefined,
) {
  return actionData?.intent === "favorite" && actionData.ok === true;
}

export function shouldAutoCloseDownloadPicker(
  actionData:
    | {
        intent: string;
        ok: boolean;
        message: string;
      }
    | undefined,
) {
  return actionData?.intent === "download_selected" && actionData.ok === true;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [{ title: "漫画详情 | JM Aura Remix" }];
};

export async function action({ params, request }: ActionFunctionArgs) {
  const id = params.id;
  if (!id) {
    throw new Response("缺少漫画 ID", { status: 400 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent !== "favorite" && intent !== "download_selected") {
    return json(
      {
        intent,
        ok: false,
        message: "暂不支持的详情页操作。",
      },
      { status: 400 },
    );
  }

  if (intent === "download_selected") {
    const chapterIds = formData
      .getAll("chapter_ids")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const selectedChapters = parseSelectedChaptersFromFormData(formData).filter((chapter) =>
      chapterIds.includes(chapter.chapterId),
    );

    if (chapterIds.length === 0) {
      return json(
        {
          intent,
          ok: false,
          message: "请至少选择 1 话再创建下载任务。",
        },
        { status: 400 },
      );
    }

    try {
      const task = await mangaDetailActionDependencies.createAlbumExportTask(request, {
        albumId: id,
        chapterIds,
        selectedChapters,
      });
      return json({
        intent,
        ok: true,
        message: "下载任务已创建，可在下载页查看进度。",
        createdTaskId: task.id,
      });
    } catch (error) {
      return json(
        {
          intent,
          ok: false,
          message: error instanceof Error ? error.message : "创建下载任务失败，请稍后重试。",
        },
        { status: 400 },
      );
    }
  }

  const folderId = String(formData.get("folder_id") ?? "0").trim() || "0";

  try {
    await mangaDetailRouteDependencies.addFavorite(request, id, folderId);
    return json({
      intent,
      ok: true,
      message: "已加入收藏夹，可在我的页继续管理。",
    });
  } catch (error) {
    return json(
      {
        intent,
        ok: false,
        message: error instanceof Error ? error.message : "收藏失败，请稍后重试。",
      },
      { status: 400 },
    );
  }
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.id;
  if (id === undefined) {
    throw new Response("缺少漫画 ID", { status: 400 });
  }

  const url = new URL(request.url);
  const { tab, order, page } = parseMangaDetailView(url);

  if (url.searchParams.get("comments-resource") === "1") {
    if (tab !== "comments") {
      return json({ comments: null, error: null });
    }

    try {
      return json({
        comments: await mangaDetailLoaderDependencies.fetchComments(request, id, { page, order }),
        error: null,
      });
    } catch (error) {
      return json({
        comments: null,
        error: error instanceof Error ? error.message : "获取评论失败，请稍后重试。",
      });
    }
  }

  const [manga, tasks] = await Promise.all([
    mangaDetailLoaderDependencies.fetchManga(request, id),
    mangaDetailLoaderDependencies.fetchTaskList(request).catch(() => [] as TaskSummary[]),
  ]);

  return json({
    apiOrigin: mangaDetailLoaderDependencies.getApiOrigin(request),
    manga,
    tasks,
  });
}

export function shouldRevalidate(args: {
  currentUrl: URL;
  nextUrl: URL;
  defaultShouldRevalidate: boolean;
  formMethod?: string;
}) {
  if (args.formMethod && args.formMethod !== "GET") {
    return args.defaultShouldRevalidate;
  }

  if (shouldSkipMangaDetailRevalidation(args.currentUrl, args.nextUrl)) {
    return false;
  }

  return args.defaultShouldRevalidate;
}

export default function MangaDetailRoute() {
  const data = useLoaderData<typeof loader>() as unknown as {
    apiOrigin: string;
    manga: Manga;
    tasks: TaskSummary[];
  };
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const { tab, order, page } = parseMangaDetailView(
    `http://localhost${navigation.location?.pathname ?? "/manga/0"}?${searchParams.toString()}`,
  );
  const pendingIntent = String(navigation.formData?.get("intent") ?? "");
  const favoritePending = pendingIntent === "favorite";
  const downloadPending = pendingIntent === "download_selected";

  return (
    <AppChrome>
      <MangaDetailResolvedContent
        actionData={actionData}
        apiOrigin={data.apiOrigin}
        downloadPending={downloadPending}
        favoritePending={favoritePending}
        manga={data.manga}
        order={order}
        page={page}
        tab={tab}
        tasks={data.tasks}
      />
    </AppChrome>
  );
}

function MangaDetailResolvedContent(props: {
  apiOrigin: string;
  manga: Manga;
  tasks: TaskSummary[];
  order: "asc" | "desc";
  page: number;
  tab: "content" | "comments";
  favoritePending: boolean;
  downloadPending: boolean;
  actionData?:
    | {
        intent: string;
        ok: boolean;
        message: string;
        createdTaskId?: string;
      }
    | undefined;
}) {
  return (
    <MangaDetailContent
      actionData={props.actionData}
      apiOrigin={props.apiOrigin}
      commentsPage={props.page}
      downloadPending={props.downloadPending}
      favoritePending={props.favoritePending}
      manga={props.manga}
      order={props.order}
      tab={props.tab}
      tasks={props.tasks}
    />
  );
}

function MangaDetailContent(props: {
  apiOrigin: string;
  manga: Manga;
  tasks: TaskSummary[];
  order: "asc" | "desc";
  tab: "content" | "comments";
  commentsPage: number;
  favoritePending: boolean;
  downloadPending: boolean;
  actionData?:
    | {
        intent: string;
        ok: boolean;
        message: string;
        createdTaskId?: string;
      }
    | undefined;
}) {
  const detailQueryLinkProps = getMangaDetailQueryLinkProps();
  const [resumeChapterId, setResumeChapterId] = useState<string | null>(null);
  const [favoritePickerOpen, setFavoritePickerOpen] = useState(false);
  const [downloadPickerOpen, setDownloadPickerOpen] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const favoriteFoldersFetcher = useFetcher<{ folders: FavoriteFolder[] }>();
  const ascendingEpisodes = useMemo(() => {
    return [...props.manga.episode_list].sort(
      (left, right) => Number(left.sort) - Number(right.sort),
    );
  }, [props.manga.episode_list]);

  const orderedEpisodes = useMemo(() => {
    const episodes = [...ascendingEpisodes];
    return props.order === "desc" ? episodes.reverse() : episodes;
  }, [ascendingEpisodes, props.order]);

  const latestTask = useMemo(() => {
    return [...props.tasks].sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  }, [props.tasks]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setResumeChapterId(
      resolveResumeChapterId(
        readStoredReadingState(window.localStorage),
        props.manga.album_id,
      ),
    );
  }, [props.manga.album_id]);

  const coverUrl =
    props.manga.image === null
      ? null
      : buildPassthroughImageUrl(props.apiOrigin, props.manga.image, "webp");
  const startEpisode = ascendingEpisodes[0] ?? null;
  const resumeEpisode =
    ascendingEpisodes.find((episode) => episode.photo_id === resumeChapterId) ??
    startEpisode;
  const resumeTo = resumeEpisode
    ? `/chapter/${resumeEpisode.photo_id}`
    : `/chapter/${props.manga.album_id}`;
  const exportTo = `/me/tasks?albumId=${encodeURIComponent(props.manga.album_id)}`;
  const latestTaskTone = latestTask ? mapTaskStatusTone(latestTask.status) : "neutral";
  const latestTaskTitle = latestTask
    ? `${formatTaskStatusLabel(latestTask.status)} · ${latestTask.type === "export_album_zip" ? "作品下载" : "收藏夹下载"}`
    : "下载";
  const favoriteFolders = favoriteFoldersFetcher.data?.folders ?? [];
  const favoriteFoldersLoading =
    favoriteFoldersFetcher.state !== "idle" && favoriteFolders.length === 0;

  useEffect(() => {
    if (shouldAutoCloseFavoritePicker(props.actionData)) {
      setFavoritePickerOpen(false);
    }
  }, [props.actionData]);

  useEffect(() => {
    if (shouldAutoCloseDownloadPicker(props.actionData)) {
      setDownloadPickerOpen(false);
      setSelectedChapterIds([]);
    }
  }, [props.actionData]);

  useEffect(() => {
    setSelectedChapterIds([]);
    setDownloadPickerOpen(false);
  }, [props.manga.album_id]);

  const openFavoritePicker = () => {
    setFavoritePickerOpen(true);
    if (favoriteFoldersFetcher.state === "idle" && favoriteFoldersFetcher.data === undefined) {
      favoriteFoldersFetcher.load(`/manga/${props.manga.album_id}/favorite-folders`);
    }
  };

  const openDownloadPicker = () => {
    setDownloadPickerOpen(true);
  };

  const toggleDownloadChapter = (chapterId: string) => {
    setSelectedChapterIds((current) =>
      current.includes(chapterId)
        ? current.filter((id) => id !== chapterId)
        : [...current, chapterId],
    );
  };

  const selectAllDownloadChapters = () => {
    setSelectedChapterIds(ascendingEpisodes.map((episode) => episode.photo_id));
  };

  const clearDownloadChapters = () => {
    setSelectedChapterIds([]);
  };

  return (
    <MangaDetailLayout
      backdropSrc={coverUrl}
      cover={
        <CoverArtwork
          src={coverUrl}
          title={props.manga.name}
          aspectRatio="3/4"
          size="compact"
          className="manga-detail-layout__cover-artwork"
        />
      }
      heroBadges={
        <>
          <span className="md-chip">ID {props.manga.album_id}</span>
          <span className="md-chip">{props.manga.episode_list.length} 话</span>
          <span className="md-chip">{props.manga.page_count} 页</span>
        </>
      }
      heroTags={
        <>
          {props.manga.tags.map((tag) => (
            <TagPill key={tag}>{tag}</TagPill>
          ))}
        </>
      }
      heroMeta={
        <>
          <div className="manga-detail-fact">
            <span className="manga-detail-fact__label">作者</span>
            <strong className="manga-detail-fact__value">{props.manga.author || "未知"}</strong>
          </div>
          <div className="manga-detail-fact">
            <span className="manga-detail-fact__label">更新</span>
            <strong className="manga-detail-fact__value">{props.manga.update_date || "未知"}</strong>
          </div>
          <div className="manga-detail-fact">
            <span className="manga-detail-fact__label">喜欢</span>
            <strong className="manga-detail-fact__value">{props.manga.likes || "0"}</strong>
          </div>
          <div className="manga-detail-fact">
            <span className="manga-detail-fact__label">浏览</span>
            <strong className="manga-detail-fact__value">{props.manga.views || "0"}</strong>
          </div>
        </>
      }
      heroActions={
        <div className="manga-detail-hero-actions">
          <DocumentNavigationLink className="md-button md-button--primary manga-detail-hero-actions__primary" to={resumeTo}>
            <span className="material-symbols-rounded" aria-hidden="true">
              play_circle
            </span>
            继续阅读
          </DocumentNavigationLink>
          <details className="manga-detail-action-menu manga-detail-action-menu--mobile">
            <summary className="md-button md-button--surface manga-detail-action-menu__trigger">
              <span className="material-symbols-rounded" aria-hidden="true">
                more_horiz
              </span>
              菜单
            </summary>
            <div className="manga-detail-action-menu__panel">
              <button
                type="button"
                className="manga-detail-action-menu__item manga-detail-action-menu__item--button"
                onClick={openFavoritePicker}
                disabled={props.favoritePending}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  {props.favoritePending ? "progress_activity" : "favorite"}
                </span>
                {props.favoritePending ? "收藏中..." : "收藏"}
              </button>
              <button
                type="button"
                className="manga-detail-action-menu__item manga-detail-action-menu__item--button"
                onClick={openDownloadPicker}
                disabled={props.downloadPending}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  download
                </span>
                {props.downloadPending ? "创建中..." : "下载"}
              </button>
            </div>
          </details>
          <div className="manga-detail-action-bar manga-detail-action-bar--desktop">
            <button
              type="button"
              className="manga-detail-action-menu__item manga-detail-action-menu__item--button"
              onClick={openFavoritePicker}
              disabled={props.favoritePending}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                {props.favoritePending ? "progress_activity" : "favorite"}
              </span>
              {props.favoritePending ? "收藏中..." : "收藏"}
            </button>
            <button
              type="button"
              className="manga-detail-action-menu__item manga-detail-action-menu__item--button"
              onClick={openDownloadPicker}
              disabled={props.downloadPending}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                download
              </span>
              {props.downloadPending ? "创建中..." : "下载"}
            </button>
          </div>
          <FavoriteFolderPicker
            open={favoritePickerOpen}
            loading={favoriteFoldersLoading}
            pending={props.favoritePending}
            folders={favoriteFolders}
            selectedFolderId="0"
            onClose={() => setFavoritePickerOpen(false)}
          />
          <DownloadChapterPicker
            open={downloadPickerOpen}
            pending={props.downloadPending}
            episodes={ascendingEpisodes}
            selectedChapterIds={selectedChapterIds}
            onToggleChapter={toggleDownloadChapter}
            onSelectAll={selectAllDownloadChapters}
            onClear={clearDownloadChapters}
            onClose={() => setDownloadPickerOpen(false)}
          />
        </div>
      }
      status={
        <>
          {props.actionData ? (
            <StatusPanel
              tone={props.actionData.ok ? "success" : "error"}
              title={
                props.actionData.intent === "download_selected"
                  ? props.actionData.ok
                    ? "下载任务已创建"
                    : "下载任务未创建"
                  : props.actionData.ok
                    ? "收藏已更新"
                    : "收藏未完成"
              }
              description={props.actionData.message}
              action={
                props.actionData.intent === "download_selected" && props.actionData.ok ? (
                  <Link className="md-button md-button--surface" prefetch="intent" to={exportTo}>
                    打开下载
                  </Link>
                ) : null
              }
            />
          ) : null}

          {latestTask ? (
            <StatusPanel
              tone={latestTaskTone}
              title={latestTaskTitle}
              description={formatTaskSummary(latestTask)}
              action={
                <Link className="md-button md-button--surface" prefetch="intent" to={exportTo}>
                  打开下载
                </Link>
              }
            />
          ) : null}
        </>
      }
      tabs={
        <nav className="manga-detail-tabs" aria-label="详情内容切换">
          <Link
            {...detailQueryLinkProps}
            to={`?tab=content&order=${props.order}`}
            className={`manga-detail-tab${props.tab === "content" ? " manga-detail-tab--active" : ""}`}
          >
            内容
            <span className="manga-detail-tab__count">{props.manga.episode_list.length}</span>
          </Link>
          <Link
            {...detailQueryLinkProps}
            to={`?tab=comments&order=${props.order}&page=1`}
            className={`manga-detail-tab${props.tab === "comments" ? " manga-detail-tab--active" : ""}`}
          >
            评论
          </Link>
        </nav>
      }
      main={
        props.tab === "comments" ? (
          <CommentsPanel
            active={props.tab === "comments"}
            albumId={props.manga.album_id}
            commentsPage={props.commentsPage}
            order={props.order}
          />
        ) : (
          <section className="manga-chapter-section">
            <SectionHeader
              title="章节列表"
              description={`${orderedEpisodes.length} 话`}
              action={
                <Link
                  className="md-button md-button--tonal"
                  {...detailQueryLinkProps}
                  to={`?tab=content&order=${props.order === "asc" ? "desc" : "asc"}`}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    swap_vert
                  </span>
                  {props.order === "asc" ? "倒序查看" : "正序查看"}
                </Link>
              }
            />

            {orderedEpisodes.length === 0 ? (
              <EmptyPanel title="暂无章节" description="当前作品还没有可用章节，稍后再来看看。" />
            ) : (
              <div className="manga-chapter-list">
                {orderedEpisodes.map((episode, index) => {
                  const isResume = episode.photo_id === resumeEpisode?.photo_id;
                  const isStart = episode.photo_id === startEpisode?.photo_id;

                  return (
                    <DocumentNavigationLink
                      key={episode.photo_id}
                      to={`/chapter/${episode.photo_id}`}
                      className={`manga-chapter-row${isResume ? " manga-chapter-row--resume" : ""}`}
                    >
                      <div className="manga-chapter-row__index">
                        {props.order === "asc" ? index + 1 : orderedEpisodes.length - index}
                      </div>

                      <div className="manga-chapter-row__copy">
                        <div className="manga-chapter-row__title">
                          {episode.name || `第 ${episode.sort} 话`}
                        </div>
                        <div className="manga-chapter-row__meta">
                          <span>第 {episode.sort} 话</span>
                          {isResume ? <span>继续阅读位置</span> : null}
                          {isStart ? <span>起始章节</span> : null}
                        </div>
                      </div>

                      <span
                        className="material-symbols-rounded manga-chapter-row__chevron"
                        aria-hidden="true"
                      >
                        chevron_right
                      </span>
                    </DocumentNavigationLink>
                  );
                })}
              </div>
            )}
          </section>
        )
      }
      title={props.manga.name}
      description={props.manga.description || "暂无简介"}
    />
  );
}

function CommentsPanel(props: {
  active: boolean;
  albumId: string;
  order: "asc" | "desc";
  commentsPage: number;
}) {
  const detailQueryLinkProps = getMangaDetailQueryLinkProps();
  const fetcher = useFetcher<{ comments: CommentsResult | null; error: string | null }>();
  const lastAutoLoadKeyRef = useRef<string | null>(null);
  const retrying = fetcher.state !== "idle";
  const result = fetcher.data?.comments ?? null;
  const loadError = fetcher.data?.error ?? null;
  const resourceUrl = useMemo(
    () =>
      `/manga/${encodeURIComponent(props.albumId)}?tab=comments&order=${props.order}&page=${props.commentsPage}&comments-resource=1`,
    [props.albumId, props.commentsPage, props.order],
  );
  const requestKey = `${props.albumId}:${props.order}:${props.commentsPage}`;

  useEffect(() => {
    if (!props.active) {
      return;
    }

    if (lastAutoLoadKeyRef.current === requestKey) {
      return;
    }

    lastAutoLoadKeyRef.current = requestKey;
    fetcher.load(resourceUrl);
  }, [props.active, requestKey, resourceUrl]);

  if (result === null && retrying) {
    return (
      <div className="md-card" style={{ padding: "18px", display: "grid", gap: "12px" }}>
        <div className="route-loading">
          <span className="material-symbols-rounded route-loading__icon">progress_activity</span>
          <p className="route-loading__text">评论加载中...</p>
        </div>
      </div>
    );
  }

  if (result === null) {
    return (
      <StatusPanel
        tone="error"
        title="评论暂时不可用"
        description={loadError ?? "评论区数据没有加载成功。"}
        action={
          <button
            className="md-button md-button--primary"
            type="button"
            onClick={() =>
              fetcher.load(
                `${resourceUrl}&nonce=${Date.now()}`,
              )
            }
            disabled={retrying}
          >
            {retrying ? "重试中..." : "重试"}
          </button>
        }
      />
    );
  }

  const comments = result.comments ?? [];
  const canPrev = props.commentsPage > 1;
  const canNext = comments.length > 0;

  return (
    <section className="md-card" style={{ padding: "18px", display: "grid", gap: "14px" }}>
      <SectionHeader
        eyebrow="评论区"
        title={`共 ${result.total} 条`}
        description={`第 ${props.commentsPage} 页`}
        action={
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <Link
              className="md-button md-button--surface"
              {...detailQueryLinkProps}
              to={`?tab=comments&order=${props.order}&page=${Math.max(1, props.commentsPage - 1)}`}
              aria-disabled={!canPrev}
              onClick={(e) => {
                if (!canPrev) e.preventDefault();
              }}
            >
              上一页
            </Link>
            <Link
              className="md-button md-button--surface"
              {...detailQueryLinkProps}
              to={`?tab=comments&order=${props.order}&page=${props.commentsPage + 1}`}
              aria-disabled={!canNext}
              onClick={(e) => {
                if (!canNext) e.preventDefault();
              }}
            >
              下一页
            </Link>
            <button
              className="md-button md-button--primary"
              type="button"
              onClick={() =>
                fetcher.load(
                  `${resourceUrl}&nonce=${Date.now()}`,
                )
              }
              disabled={retrying}
            >
              {retrying ? "刷新中..." : "刷新"}
            </button>
          </div>
        }
      />

      {comments.length === 0 ? (
        <EmptyPanel title="暂无评论" description="这部作品暂时还没有可显示的评论。" />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {comments.map((item) => {
            const metaLabels = getCommentMetaLabels(item.parent_id);

            return (
              <div
                key={item.id}
                className="md-card"
                style={{
                  padding: "14px 16px",
                  background: "var(--md-sys-color-surface-container)",
                  display: "grid",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <strong style={{ font: "var(--md-sys-typescale-title-medium)" }}>
                    {item.user || "匿名用户"}
                  </strong>
                  <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
                    {item.time || ""}
                  </span>
                </div>
                <div style={{ color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.6 }}>
                  {item.content || "（空）"}
                </div>
                {metaLabels.length > 0 ? (
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    {metaLabels.map((label) => (
                      <span key={label} className="md-chip">
                        {label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
