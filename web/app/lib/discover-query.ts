import {
  CATEGORY_VALUES,
  ORDER_BY_VALUES,
  TIME_VALUES,
  type Category,
  type OrderBy,
  type TimeRange,
} from "../../../packages/shared/src/schema";

const VALID_CATEGORIES = new Set<Category>(CATEGORY_VALUES);
const VALID_ORDER_BY = new Set<OrderBy>(ORDER_BY_VALUES);
const VALID_TIME = new Set<TimeRange>(TIME_VALUES);

export type DiscoverQuery = {
  category: Category;
  sub_category: string | undefined;
  order_by: OrderBy;
  time: TimeRange;
  page: number;
};

export const DEFAULT_DISCOVER_QUERY: DiscoverQuery = {
  category: "",
  sub_category: undefined,
  order_by: "mv",
  time: "a",
  page: 1,
};

export const DISCOVER_CATEGORY_OPTIONS: Array<{ value: Category; label: string }> = [
  { value: "", label: "全部" },
  { value: "doujin", label: "同人" },
  { value: "single", label: "单本" },
  { value: "short", label: "短篇" },
  { value: "another", label: "其他" },
  { value: "hanman", label: "韩漫" },
  { value: "meiman", label: "美漫" },
  { value: "doujin_3d", label: "3D" },
  { value: "doujin_cg", label: "CG" },
];

export const DISCOVER_ORDER_OPTIONS: Array<{ value: OrderBy; label: string }> = [
  { value: "mv", label: "最多观看" },
  { value: "mr", label: "最新" },
  { value: "mp", label: "最多图片" },
  { value: "tf", label: "最多收藏" },
];

export const DISCOVER_TIME_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: "a", label: "全部时间" },
  { value: "t", label: "今天" },
  { value: "w", label: "本周" },
  { value: "m", label: "本月" },
];

const DISCOVER_SUB_CATEGORY_SUGGESTIONS: Partial<Record<Category, readonly string[]>> = {
  doujin: ["CG", "Manga", "Cosplay", "3D"],
  doujin_cg: ["CG", "Game CG", "Original"],
  doujin_3d: ["3D", "Animation", "VR"],
};

export function parseDiscoverParams(params: URLSearchParams): DiscoverQuery {
  const category = normalizeCategory(params.get("category"));
  const subCategory = normalizeSubCategory(params.get("sub_category"));

  return {
    category,
    sub_category: category.length > 0 ? subCategory : undefined,
    order_by: normalizeOrderBy(params.get("order_by")),
    time: normalizeTime(params.get("time")),
    page: normalizePage(params.get("page")),
  };
}

export function buildDiscoverHref(next: Partial<DiscoverQuery>, current: DiscoverQuery = DEFAULT_DISCOVER_QUERY) {
  const merged: DiscoverQuery = {
    ...current,
    ...next,
    category: normalizeCategory(next.category ?? current.category),
    sub_category: normalizeSubCategory(next.sub_category ?? current.sub_category),
    order_by: normalizeOrderBy(next.order_by ?? current.order_by),
    time: normalizeTime(next.time ?? current.time),
    page: normalizePage(String(next.page ?? current.page)),
  };

  if (merged.category.length === 0) {
    merged.sub_category = undefined;
  }

  if (next.category !== undefined && next.page === undefined) {
    merged.page = 1;
  }

  if (next.sub_category !== undefined && next.page === undefined) {
    merged.page = 1;
  }

  if (next.order_by !== undefined || next.time !== undefined) {
    merged.page = 1;
  }

  const params = new URLSearchParams();

  if (merged.category.length > 0) {
    params.set("category", merged.category);
  }

  if (merged.sub_category) {
    params.set("sub_category", merged.sub_category);
  }

  params.set("order_by", merged.order_by);
  params.set("time", merged.time);
  params.set("page", String(merged.page));

  return `/discover?${params.toString()}`;
}

export function getDiscoverSubCategorySuggestions(category: Category): readonly string[] {
  return DISCOVER_SUB_CATEGORY_SUGGESTIONS[category] ?? [];
}

function normalizeCategory(value: string | null | undefined): Category {
  return value != null && VALID_CATEGORIES.has(value as Category) ? (value as Category) : "";
}

function normalizeSubCategory(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeOrderBy(value: string | null | undefined): OrderBy {
  return value != null && VALID_ORDER_BY.has(value as OrderBy) ? (value as OrderBy) : "mv";
}

function normalizeTime(value: string | null | undefined): TimeRange {
  return value != null && VALID_TIME.has(value as TimeRange) ? (value as TimeRange) : "a";
}

function normalizePage(value: string | null | undefined) {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
