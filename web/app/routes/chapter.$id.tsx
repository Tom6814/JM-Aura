import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { useLoaderData, useMatches } from "@remix-run/react";
import {
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Chapter, Manga } from "../../../packages/shared/src/schema";
import { buildImageProxyUrl } from "../lib/jm-media";
import { fetchChapter, fetchManga, getApiOrigin } from "../lib/jm-rpc.server";
import {
  formatReaderStatus,
  readStoredReaderWidth,
  writeStoredReaderWidth,
  writeStoredReadingState,
} from "../lib/reading-state";
import { ReaderOverlay } from "../components/reader-overlay";
import { AppChrome, DocumentNavigationLink, StatusPanel } from "../components/ui";

export const readerRouteLoaderDependencies = {
  fetchChapter,
  fetchManga,
  getApiOrigin,
};

type ChapterNavigationDirection = "previous" | "next";

export function shouldBeginChapterNavigationFeedback(event: {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

export function getChapterNavigationPendingMessage(
  direction: ChapterNavigationDirection,
  slow: boolean,
) {
  if (slow) {
    return "章节切换较慢，请稍等…";
  }

  return direction === "previous" ? "正在进入上一话…" : "正在进入下一话…";
}

export const meta: MetaFunction<typeof loader> = () => {
  return [{ title: "章节阅读 | JM Aura Remix" }];
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.id;
  if (id === undefined) {
    throw new Response("缺少章节 ID", { status: 400 });
  }

  const apiOrigin = readerRouteLoaderDependencies.getApiOrigin(request);
  const chapter = await readerRouteLoaderDependencies.fetchChapter(request, id);
  const manga = await readerRouteLoaderDependencies.fetchManga(request, chapter.album_id).catch(() => null);

  return json({
    apiOrigin,
    chapter,
    manga,
  });
}

export default function ChapterReaderRoute() {
  const data = useLoaderData<typeof loader>() as unknown as {
    apiOrigin: string;
    chapter: Chapter;
    manga: Manga | null;
  };

  return (
    <AppChrome immersive>
      <ChapterReaderContent apiOrigin={data.apiOrigin} chapter={data.chapter} manga={data.manga} />
    </AppChrome>
  );
}

function ChapterReaderContent(props: {
  apiOrigin: string;
  chapter: Chapter;
  manga: Manga | null;
}) {
  const matches = useMatches();
  const theme = useMemo(() => {
    const rootMatch = matches.find((match) => match.id === "root");
    const rootData =
      typeof rootMatch?.data === "object" && rootMatch.data !== null
        ? rootMatch.data
        : null;
    return rootData && "theme" in rootData && rootData.theme === "light"
      ? "light"
      : "dark";
  }, [matches]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [readerWidth, setReaderWidth] = useState(760);
  const [showChrome, setShowChrome] = useState(true);
  const [pendingNavigation, setPendingNavigation] = useState<{
    direction: ChapterNavigationDirection;
    slow: boolean;
  } | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const navigationSlowTimerRef = useRef<number | null>(null);
  const imageRefs = useRef<Array<HTMLImageElement | null>>([]);

  const imageUrls = useMemo(
    () =>
      props.chapter.image_list.map((image) =>
        buildImageProxyUrl(props.apiOrigin, image, theme === "light" ? "jpeg" : "webp"),
      ),
    [props.apiOrigin, props.chapter.image_list, theme],
  );

  const chapterNavigation = useMemo(() => {
    if (props.manga === null) {
      return { previous: null, next: null };
    }

    const episodes = [...props.manga.episode_list].sort((left, right) => Number(left.sort) - Number(right.sort));
    const currentIndex = episodes.findIndex((episode) => episode.photo_id === props.chapter.photo_id);
    if (currentIndex === -1) {
      return { previous: null, next: null };
    }

    return {
      previous: currentIndex > 0 ? episodes[currentIndex - 1] : null,
      next: currentIndex < episodes.length - 1 ? episodes[currentIndex + 1] : null,
    };
  }, [props.chapter.photo_id, props.manga]);

  const episodes = useMemo(() => {
    if (props.manga === null) {
      return [];
    }
    return [...props.manga.episode_list].sort((left, right) => Number(left.sort) - Number(right.sort));
  }, [props.manga]);

  const currentChapterIndex = useMemo(() => {
    return episodes.findIndex((episode) => episode.photo_id === props.chapter.photo_id);
  }, [episodes, props.chapter.photo_id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setReaderWidth(readStoredReaderWidth(window.localStorage));
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    imageRefs.current = [];
    setPendingNavigation(null);
  }, [props.chapter.photo_id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeStoredReaderWidth(window.localStorage, readerWidth);
  }, [readerWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pageCount = Math.max(1, props.chapter.image_list.length);
    const progress = pageCount <= 1 ? 1 : activeIndex / (pageCount - 1);
    writeStoredReadingState(window.localStorage, {
      mangaId: props.chapter.album_id,
      chapterId: props.chapter.photo_id,
      progress,
    });
  }, [activeIndex, props.chapter.album_id, props.chapter.image_list.length, props.chapter.photo_id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isTouchDevice = window.matchMedia?.("(pointer: coarse)").matches;

    // 触屏设备上不自动隐藏控件：避免用户点“上一话/下一话”时控件刚好消失导致“点了没反应”的错觉。
    if (isTouchDevice) {
      return;
    }

    if (showChrome) {
      if (hideControlsTimerRef.current !== null) {
        window.clearTimeout(hideControlsTimerRef.current);
      }
      hideControlsTimerRef.current = window.setTimeout(() => setShowChrome(false), 5200);
    }
    return () => {
      if (hideControlsTimerRef.current !== null) {
        window.clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [showChrome, activeIndex]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (!visibleEntry) {
          return;
        }

        const nextIndex = Number(
          (visibleEntry.target as HTMLImageElement).dataset.pageIndex ?? 0,
        );
        if (Number.isFinite(nextIndex)) {
          setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
        }
      },
      { rootMargin: "-18% 0px -18% 0px", threshold: [0.55, 0.75] },
    );

    for (const node of imageRefs.current) {
      if (node) {
        observer.observe(node);
      }
    }

    return () => observer.disconnect();
  }, [props.chapter.image_list.length, props.chapter.photo_id]);

  useEffect(() => {
    return () => {
      if (navigationSlowTimerRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(navigationSlowTimerRef.current);
      }
    };
  }, []);

  function onControlAction(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
    setShowChrome(true);
  }

  function onChapterNavigationClick(
    event: MouseEvent<HTMLAnchorElement>,
    direction: ChapterNavigationDirection,
  ) {
    onControlAction(event);

    if (!shouldBeginChapterNavigationFeedback(event)) {
      return;
    }

    if (pendingNavigation !== null) {
      event.preventDefault();
      return;
    }

    setPendingNavigation({ direction, slow: false });

    if (navigationSlowTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(navigationSlowTimerRef.current);
    }

    if (typeof window !== "undefined") {
      navigationSlowTimerRef.current = window.setTimeout(() => {
        setPendingNavigation((current) =>
          current === null ? null : { ...current, slow: true },
        );
      }, 1500);
    }
  }

  return (
    <div className="reader-shell" onClick={() => setShowChrome((current) => !current)}>
      <ReaderOverlay
        showChrome={showChrome}
        onTopBarClick={onControlAction}
        onBottomBarClick={onControlAction}
        topBar={
          <>
            <DocumentNavigationLink
              prefetch="intent"
              to={`/manga/${props.chapter.album_id}`}
              className="md-button md-button--surface reader-control-button"
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                arrow_back
              </span>
            </DocumentNavigationLink>
            <div className="reader-topbar__copy">
              <div className="reader-topbar__title">{props.chapter.indextitle}</div>
              <div className="reader-topbar__meta">
                {props.manga?.name ?? "Manga"}
                {episodes.length > 0 && currentChapterIndex >= 0
                  ? ` · 第 ${currentChapterIndex + 1}/${episodes.length} 话`
                  : ""}
              </div>
            </div>
            <button
              type="button"
              className="md-button md-button--surface reader-control-button"
              onClick={(event) => {
                onControlAction(event);
                setShowChrome(false);
              }}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                visibility_off
              </span>
            </button>
          </>
        }
        bottomBar={
          <>
            <div className="reader-bottombar__nav">
              {chapterNavigation.previous ? (
                <DocumentNavigationLink
                  to={`/chapter/${chapterNavigation.previous.photo_id}`}
                  className="md-button md-button--surface reader-bottombar__nav-button"
                  onClick={(event) => onChapterNavigationClick(event, "previous")}
                  aria-disabled={pendingNavigation !== null}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    navigate_before
                  </span>
                  上一话
                </DocumentNavigationLink>
              ) : (
                <span className="reader-control-spacer" />
              )}

              <DocumentNavigationLink
                prefetch="intent"
                to={`/manga/${props.chapter.album_id}`}
                className="reader-bottombar__meta"
              >
                返回漫画详情
              </DocumentNavigationLink>

              {chapterNavigation.next ? (
                <DocumentNavigationLink
                  to={`/chapter/${chapterNavigation.next.photo_id}`}
                  className="md-button md-button--surface reader-bottombar__nav-button"
                  onClick={(event) => onChapterNavigationClick(event, "next")}
                  aria-disabled={pendingNavigation !== null}
                >
                  下一话
                  <span className="material-symbols-rounded" aria-hidden="true">
                    navigate_next
                  </span>
                </DocumentNavigationLink>
              ) : (
                <span className="reader-control-spacer" />
              )}
            </div>

            <div className="reader-bottombar__actions">
              <div className="reader-width-switcher">
                <button
                  type="button"
                  className="md-button md-button--surface"
                  onClick={(event) => {
                    onControlAction(event);
                    setReaderWidth((current) => Math.max(320, current - 80));
                  }}
                >
                  更窄
                </button>
                <button
                  type="button"
                  className="md-button md-button--surface"
                  onClick={(event) => {
                    onControlAction(event);
                    setShowChrome(false);
                  }}
                >
                  收起控件
                </button>
                <button
                  type="button"
                  className="md-button md-button--surface"
                  onClick={(event) => {
                    onControlAction(event);
                    setReaderWidth((current) => Math.min(1040, current + 80));
                  }}
                >
                  更宽
                </button>
              </div>
            </div>

            <div className="reader-bottombar__status">
              {formatReaderStatus({
                activeIndex,
                total: props.chapter.image_list.length,
                readerWidth,
              })}
              {episodes.length > 0 && currentChapterIndex >= 0
                ? ` · 第 ${currentChapterIndex + 1}/${episodes.length} 话`
                : ""}
            </div>
          </>
        }
      />

      {pendingNavigation ? (
        <div className="reader-navigation-feedback" aria-live="polite">
          <span className="material-symbols-rounded reader-navigation-feedback__icon" aria-hidden="true">
            progress_activity
          </span>
          <span>{getChapterNavigationPendingMessage(pendingNavigation.direction, pendingNavigation.slow)}</span>
        </div>
      ) : null}

      <main className="reader-webtoon" style={{ ["--reader-width" as string]: `${readerWidth}px` }}>
        {props.chapter.image_list.map((image, index) => (
          <img
            key={image.index}
            ref={(node) => {
              imageRefs.current[index] = node;
            }}
            data-page-index={index}
            src={imageUrls[index] ?? buildImageProxyUrl(props.apiOrigin, image, "webp")}
            alt={`第 ${image.index} 页`}
            loading={index < 2 ? "eager" : "lazy"}
            decoding="async"
            className="reader-webtoon__image"
          />
        ))}

        <div className="reader-endcap">
          <span className="material-symbols-rounded reader-endcap__icon" aria-hidden="true">
            bedtime
          </span>
          <h3 className="reader-endcap__title">本话已阅读完毕</h3>
          <p className="reader-endcap__description">
            当前阅读进度已经自动写回本地，下次会优先回到这里继续看。
          </p>

          {chapterNavigation.next ? (
            <DocumentNavigationLink
              to={`/chapter/${chapterNavigation.next.photo_id}`}
              className="md-button md-button--primary"
              onClick={(event) => onChapterNavigationClick(event, "next")}
              aria-disabled={pendingNavigation !== null}
            >
              继续阅读下一话
              <span className="material-symbols-rounded" aria-hidden="true">
                arrow_forward
              </span>
            </DocumentNavigationLink>
          ) : (
            <DocumentNavigationLink
              prefetch="intent"
              to={`/manga/${props.chapter.album_id}`}
              className="md-button md-button--tonal"
            >
              返回漫画详情
            </DocumentNavigationLink>
          )}
        </div>
      </main>
    </div>
  );
}
