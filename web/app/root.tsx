import {
  json,
  type LinksFunction,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";

import componentsStylesHref from "./styles/components.css";
import appStylesHref from "./styles/app.css";
import readerStylesHref from "./styles/reader.css";
import shellStylesHref from "./styles/shell.css";
import tokensStylesHref from "./styles/tokens.css";
import { readThemeFromRequest } from "./lib/theme.server";

function getThemeColor(theme: "dark" | "light") {
  return theme === "light" ? "#fcf7f8" : "#1a1112";
}

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.loli.net", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.loli.net/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" },
  {
    rel: "stylesheet",
    href: "https://fonts.loli.net/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&display=swap",
  },
  { rel: "stylesheet", href: tokensStylesHref },
  { rel: "stylesheet", href: shellStylesHref },
  { rel: "stylesheet", href: componentsStylesHref },
  { rel: "stylesheet", href: readerStylesHref },
  { rel: "stylesheet", href: appStylesHref },
];

export async function loader({ request }: LoaderFunctionArgs) {
  return json({
    theme: await readThemeFromRequest(request),
  });
}

export default function App() {
  const data = useLoaderData<typeof loader>();
  const themeColor = getThemeColor(data.theme);

  return (
    <html lang="zh-CN" data-theme={data.theme} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <meta name="theme-color" content={themeColor} />
        <Meta />
        <Links />
      </head>
      <body className="app-root-body">
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "未知错误";

  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <meta name="theme-color" content={getThemeColor("dark")} />
        <Meta />
        <Links />
      </head>
      <body className="app-root-body">
        <main className="app-shell">
          <section className="app-container" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: "16px", textAlign: "center" }}>
            <span className="md-chip" style={{ backgroundColor: "var(--md-sys-color-error-container)", color: "var(--md-sys-color-on-error-container)", border: "none" }}>Error State</span>
            <h1 style={{ font: "var(--md-sys-typescale-display-small)" }}>页面加载失败</h1>
            <p style={{ font: "var(--md-sys-typescale-body-large)", color: "var(--md-sys-color-on-surface-variant)" }}>{message}</p>
          </section>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
