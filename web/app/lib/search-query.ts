import type { OrderBy, SearchMainTag, TimeRange } from "../../../packages/shared/src/schema";

const VALID_MAIN_TAGS = new Set<SearchMainTag>([0, 1, 2, 3, 4]);
const VALID_ORDER_BY = new Set<OrderBy>(["mr", "mv", "mp", "tf"]);
const VALID_TIME = new Set<TimeRange>(["a", "t", "w", "m"]);

export interface ParsedSearchParams {
  keyword: string;
  page: number;
  main_tag: SearchMainTag;
  order_by: OrderBy;
  time: TimeRange;
}

export function parseSearchParams(params: URLSearchParams): ParsedSearchParams {
  const keyword = params.get("q")?.trim() || params.get("keyword")?.trim() || "";

  return {
    keyword,
    page: keyword.length > 0 ? normalizePositivePage(params.get("page")) : 1,
    main_tag: normalizeMainTag(params.get("main_tag")),
    order_by: normalizeOrderBy(params.get("order_by")),
    time: normalizeTimeRange(params.get("time")),
  };
}

function normalizePositivePage(value: string | null): number {
  if (value === null) {
    return 1;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeMainTag(value: string | null): SearchMainTag {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  return VALID_MAIN_TAGS.has(parsed as SearchMainTag) ? (parsed as SearchMainTag) : 0;
}

function normalizeOrderBy(value: string | null): OrderBy {
  return value !== null && VALID_ORDER_BY.has(value as OrderBy) ? (value as OrderBy) : "mr";
}

function normalizeTimeRange(value: string | null): TimeRange {
  return value !== null && VALID_TIME.has(value as TimeRange) ? (value as TimeRange) : "a";
}
