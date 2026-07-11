import { createCookie } from "@remix-run/node";

import { normalizeThemeName, type ThemeName } from "./reading-state";

export const themeCookie = createCookie("jm_theme", {
  path: "/",
  sameSite: "lax",
  httpOnly: false,
  maxAge: 60 * 60 * 24 * 365,
});

export async function readThemeFromRequest(request: Request): Promise<ThemeName> {
  const cookieHeader = request.headers.get("Cookie");
  const raw = await themeCookie.parse(cookieHeader);
  return normalizeThemeName(typeof raw === "string" ? raw : null);
}

export function serializeThemeCookie(theme: string) {
  return themeCookie.serialize(normalizeThemeName(theme));
}
