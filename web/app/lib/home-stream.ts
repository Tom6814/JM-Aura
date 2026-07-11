import type { Manga, SearchResultItem } from "../../../packages/shared/src/schema";
import type { ReadingState } from "./reading-state";

export type HomeStreamSectionKey =
  | "latest"
  | "ranking-today"
  | "ranking-week"
  | "ranking-month";

export type HomeContinueReadingSegment = {
  item: SearchResultItem | null;
  sourceLabel: string;
  href: string;
  actionLabel: string;
};

export type HomeStreamPayload = {
  continueReading: Promise<HomeContinueReadingSegment>;
  latest: Promise<SearchResultItem[]>;
  rankingToday: Promise<SearchResultItem[]>;
  rankingWeek: Promise<SearchResultItem[]>;
  rankingMonth: Promise<SearchResultItem[]>;
};

export type HomeStreamDataKey = keyof HomeStreamPayload;

export type HomeStreamSectionMeta = {
  queryValue:
    | "continue-reading"
    | "latest"
    | "ranking-today"
    | "ranking-week"
    | "ranking-month";
  title: string;
  loadingTitle: string;
  loadingDescription: string;
  errorTitle: string;
  errorDescription: string;
  retryLabel: string;
};

type HomeStreamResolvers = {
  continueReading: () => Promise<HomeContinueReadingSegment>;
  latest: () => Promise<SearchResultItem[]>;
  rankingToday: () => Promise<SearchResultItem[]>;
  rankingWeek: () => Promise<SearchResultItem[]>;
  rankingMonth: () => Promise<SearchResultItem[]>;
};

export function getHomeStreamCacheKey(
  key: HomeStreamSectionKey,
  category: string,
) {
  return `home:${key}:${category}`;
}

export function createHomeStreamPayload(
  input: HomeStreamResolvers,
): HomeStreamPayload {
  return {
    continueReading: input.continueReading(),
    latest: input.latest(),
    rankingToday: input.rankingToday(),
    rankingWeek: input.rankingWeek(),
    rankingMonth: input.rankingMonth(),
  };
}

export function getHomeStreamSectionMeta(
  key: HomeStreamDataKey,
): HomeStreamSectionMeta {
  switch (key) {
    case "continueReading":
      return {
        queryValue: "continue-reading",
        title: "继续阅读",
        loadingTitle: "继续阅读正在同步",
        loadingDescription: "当前区块会在数据返回后独立填充。",
        errorTitle: "继续阅读同步失败",
        errorDescription: "当前区块没有同步成功。",
        retryLabel: "重试当前区块",
      };
    case "latest":
      return {
        queryValue: "latest",
        title: "最新更新",
        loadingTitle: "最新更新正在同步",
        loadingDescription: "当前区块会在数据返回后独立填充。",
        errorTitle: "最新更新加载失败",
        errorDescription: "当前区块没有同步成功。",
        retryLabel: "重试当前区块",
      };
    case "rankingToday":
      return {
        queryValue: "ranking-today",
        title: "今日热门",
        loadingTitle: "今日热门正在同步",
        loadingDescription: "当前区块会在数据返回后独立填充。",
        errorTitle: "今日热门加载失败",
        errorDescription: "当前区块没有同步成功。",
        retryLabel: "重试当前区块",
      };
    case "rankingWeek":
      return {
        queryValue: "ranking-week",
        title: "本周热门",
        loadingTitle: "本周热门正在同步",
        loadingDescription: "当前区块会在数据返回后独立填充。",
        errorTitle: "本周热门加载失败",
        errorDescription: "当前区块没有同步成功。",
        retryLabel: "重试当前区块",
      };
    case "rankingMonth":
      return {
        queryValue: "ranking-month",
        title: "本月热门",
        loadingTitle: "本月热门正在同步",
        loadingDescription: "当前区块会在数据返回后独立填充。",
        errorTitle: "本月热门加载失败",
        errorDescription: "当前区块没有同步成功。",
        retryLabel: "重试当前区块",
      };
  }
}

export async function resolveContinueReadingSegment(
  input: Pick<
    HomeStreamResolvers,
    "latest" | "rankingToday" | "rankingWeek" | "rankingMonth"
  >,
): Promise<HomeContinueReadingSegment> {
  const sections: Array<{
    label: string;
    loader: () => Promise<SearchResultItem[]>;
  }> = [
    { label: "最新更新", loader: input.latest },
    { label: "今日热门", loader: input.rankingToday },
    { label: "本周热门", loader: input.rankingWeek },
    { label: "本月热门", loader: input.rankingMonth },
  ];

  for (const section of sections) {
    try {
      const items = await section.loader();
      if (items[0]) {
        return {
          item: items[0],
          sourceLabel: section.label,
          href: `/manga/${items[0].id}`,
          actionLabel: "继续",
        };
      }
    } catch {
      continue;
    }
  }

  return {
    item: null,
    sourceLabel: "最新更新",
    href: "/search?order_by=mr",
    actionLabel: "看最新",
  };
}

export function buildHistoryContinueReadingSegment(
  state: ReadingState,
  manga: Pick<Manga, "album_id" | "name" | "image" | "author" | "tags">,
): HomeContinueReadingSegment | null {
  if (state.mangaId !== manga.album_id) {
    return null;
  }

  return {
    item: {
      id: manga.album_id,
      name: manga.name,
      tags: manga.tags,
      author: manga.author || null,
      description: null,
      image: manga.image,
    },
    sourceLabel: "上次读到",
    href: `/chapter/${state.chapterId}`,
    actionLabel: "继续阅读",
  };
}
