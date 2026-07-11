import { createCookie } from "@remix-run/node";

import { normalizeFavoritesPageSize, type FavoritesPageSize } from "./me-settings";

const favoritesPageSizeCookie = createCookie("jm_favorites_page_size", {
  path: "/",
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 365,
});

export async function getFavoritesPageSize(request: Request): Promise<FavoritesPageSize> {
  const raw = await favoritesPageSizeCookie.parse(request.headers.get("Cookie"));
  return normalizeFavoritesPageSize(raw);
}

export async function setFavoritesPageSize(headers: Headers, value: FavoritesPageSize): Promise<void> {
  headers.append("Set-Cookie", await favoritesPageSizeCookie.serialize(String(value)));
}
