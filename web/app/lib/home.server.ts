import type { HomeFeed, SearchResultItem } from "../../../packages/shared/src/schema";

export type HomeFeaturedSource = "latest" | "today" | "week" | "month";
export type HomeEntryPointKey = "latest" | "hot" | "categories";

export type HomeEntryPoint = {
  key: HomeEntryPointKey;
  label: string;
  href: string;
  description: string;
  icon: string;
};

export type HomeSections = {
  featured: SearchResultItem | null;
  featuredSource: HomeFeaturedSource;
  entryPoints: HomeEntryPoint[];
  latest: SearchResultItem[];
  rankings: {
    today: SearchResultItem[];
    week: SearchResultItem[];
    month: SearchResultItem[];
  };
};

export function createEmptyHomeSections(): HomeSections {
  return {
    featured: null,
    featuredSource: "latest",
    entryPoints: createHomeEntryPoints(),
    latest: [],
    rankings: {
      today: [],
      week: [],
      month: [],
    },
  };
}

export function mapHomeFeedToSections(feed: HomeFeed): HomeSections {
  const latest = feed.latest.content;
  const rankings = {
    today: feed.rankings.today.content,
    week: feed.rankings.week.content,
    month: feed.rankings.month.content,
  };
  const featured = latest[0] ?? rankings.today[0] ?? rankings.week[0] ?? rankings.month[0] ?? null;
  const featuredSource: HomeFeaturedSource = latest[0]
    ? "latest"
    : rankings.today[0]
      ? "today"
      : rankings.week[0]
        ? "week"
        : rankings.month[0]
          ? "month"
          : "latest";

  return {
    ...createEmptyHomeSections(),
    featured,
    featuredSource,
    latest,
    rankings,
  };
}

function createHomeEntryPoints(): HomeEntryPoint[] {
  return [
    {
      key: "latest",
      label: "最新",
      href: "/search?order_by=mr",
      description: "更新流",
      icon: "bolt",
    },
    {
      key: "hot",
      label: "热门",
      href: "/search?order_by=mv&time=t",
      description: "今日热度",
      icon: "local_fire_department",
    },
    {
      key: "categories",
      label: "分类",
      href: "/discover",
      description: "分类入口",
      icon: "grid_view",
    },
  ];
}
