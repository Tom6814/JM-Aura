export const FAVORITES_PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 60] as const;
export type FavoritesPageSize = (typeof FAVORITES_PAGE_SIZE_OPTIONS)[number];

const DEFAULT_FAVORITES_PAGE_SIZE: FavoritesPageSize = 20;

export function normalizeFavoritesPageSize(input: unknown): FavoritesPageSize {
  const parsed = typeof input === "string" ? Number.parseInt(input, 10) : Number(input);
  if (FAVORITES_PAGE_SIZE_OPTIONS.includes(parsed as FavoritesPageSize)) {
    return parsed as FavoritesPageSize;
  }
  return DEFAULT_FAVORITES_PAGE_SIZE;
}

