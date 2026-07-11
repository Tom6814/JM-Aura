export type MangaDetailTab = "content" | "comments";
export type MangaDetailOrder = "asc" | "desc";

export function parseMangaDetailView(url: URL | string): {
  tab: MangaDetailTab;
  order: MangaDetailOrder;
  page: number;
} {
  const resolvedUrl = typeof url === "string" ? new URL(url, "http://localhost") : url;
  const tab = resolvedUrl.searchParams.get("tab") === "comments" ? "comments" : "content";
  const order = resolvedUrl.searchParams.get("order") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(resolvedUrl.searchParams.get("page") ?? 1) || 1);

  return { tab, order, page };
}

/**
 * Detail-page UI-only query changes should not trigger full route revalidation.
 * We keep the shell + manga payload stable and let sub-sections fetch on demand.
 */
export function shouldSkipMangaDetailRevalidation(currentUrl: URL | string, nextUrl: URL | string): boolean {
  const current = typeof currentUrl === "string" ? new URL(currentUrl, "http://localhost") : currentUrl;
  const next = typeof nextUrl === "string" ? new URL(nextUrl, "http://localhost") : nextUrl;

  if (current.pathname !== next.pathname) {
    return false;
  }

  const allowedKeys = new Set(["tab", "order", "page"]);
  const allKeys = new Set([...current.searchParams.keys(), ...next.searchParams.keys()]);

  for (const key of allKeys) {
    if (!allowedKeys.has(key)) {
      return false;
    }
  }

  return true;
}

