import type { ReactNode } from "react";
import { Form, Link, useFetchers, useLocation, useMatches, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";

import {
  DOCUMENT_NAVIGATION_START_EVENT,
  getNavigationProgressSnapshot,
  reduceNavigationProgress,
  type NavigationProgressState,
} from "../lib/navigation-progress";
import {
  THEME_STORAGE_KEY,
  type ThemeName,
  readStoredTheme,
  writeStoredTheme,
} from "../lib/reading-state";

const SHELL_IMMERSIVE_STORAGE_KEY = "jm_shell_immersive";
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type AppChromeProps = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  primarySlot?: ReactNode;
  showSearch?: boolean;
  children: ReactNode;
  immersive?: boolean;
  reader?: boolean;
};

type NavItem = {
  to: string;
  label: string;
  icon: string;
  active: boolean;
};

type MenuItem = {
  to: string;
  label: string;
  icon: string;
  active: boolean;
};

export function AppChrome(props: AppChromeProps) {
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const location = useLocation();
  const matches = useMatches();
  const hasPendingFetchers = fetchers.some((fetcher) => fetcher.state !== "idle");
  const loaderTheme = useMemo<ThemeName>(() => {
    const rootMatch = matches.find((match) => match.id === "root");
    const rawTheme =
      typeof rootMatch?.data === "object" &&
      rootMatch.data !== null &&
      "theme" in rootMatch.data
        ? rootMatch.data.theme
        : null;
    return rawTheme === "light" ? "light" : "dark";
  }, [matches]);

  const [theme, setTheme] = useState<ThemeName>(loaderTheme);
  const [shellImmersive, setShellImmersive] = useState(false);
  const [progress, setProgress] = useState<NavigationProgressState>({
    visible: false,
    value: 0,
    phase: "idle",
  });

  useEffect(() => {
    setTheme(loaderTheme);
  }, [loaderTheme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setTheme(readStoredTheme(window.localStorage));
    setShellImmersive(window.localStorage.getItem(SHELL_IMMERSIVE_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SHELL_IMMERSIVE_STORAGE_KEY, shellImmersive ? "true" : "false");
  }, [shellImmersive]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.dataset.theme = theme;
    document.cookie = `jm_theme=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
    if (typeof window !== "undefined") {
      writeStoredTheme(window.localStorage, theme);
    }
    document.body.dataset.shellImmersive = shellImmersive ? "true" : "false";

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta instanceof HTMLMetaElement) {
      themeColorMeta.content = theme === "light" ? "#fcf7f8" : "#1a1112";
    }
  }, [shellImmersive, theme]);

  useEffect(() => {
    setProgress((previous) =>
      getNavigationProgressSnapshot({
        navigationState: navigation.state,
        hasPendingFetchers,
        previous,
      }),
    );
  }, [hasPendingFetchers, navigation.state]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (progress.phase !== "running") {
      return;
    }

    const timerId = window.setInterval(() => {
      setProgress((previous) => reduceNavigationProgress(previous, { type: "tick" }));
    }, 160);

    return () => window.clearInterval(timerId);
  }, [progress.phase]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (progress.phase !== "completing") {
      return;
    }

    const timerId = window.setTimeout(() => {
      setProgress({ visible: false, value: 0, phase: "idle" });
    }, 180);

    return () => window.clearTimeout(timerId);
  }, [progress.phase]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onDocumentNavigationStart = () => {
      setProgress((previous) => reduceNavigationProgress(previous, { type: "navigation-start" }));
    };

    window.addEventListener(DOCUMENT_NAVIGATION_START_EVENT, onDocumentNavigationStart as EventListener);
    return () => {
      window.removeEventListener(DOCUMENT_NAVIGATION_START_EVENT, onDocumentNavigationStart as EventListener);
    };
  }, []);

  if (props.immersive || props.reader) {
    return <>{props.children}</>;
  }

  const pathname = location.pathname;
  const nextTheme = theme === "dark" ? "light" : "dark";
  const searchSlot =
    props.showSearch === false
      ? null
      : props.primarySlot ?? (
          <Form reloadDocument method="get" action="/search" className="app-topbar__search" role="search">
            <div className="md-search-bar md-search-bar--compact">
              <span className="material-symbols-rounded" aria-hidden="true">
                search
              </span>
              <input
                className="md-search-bar__input"
                name="q"
                type="search"
                placeholder="搜索作品、作者、车号…"
              />
            </div>
          </Form>
        );

  const navItems: NavItem[] = [
    { to: "/", label: "首页", icon: "home", active: pathname === "/" },
    {
      to: "/search",
      label: "搜索",
      icon: "search",
      active: pathname.startsWith("/search"),
    },
    {
      to: "/discover",
      label: "发现",
      icon: "explore",
      active: pathname.startsWith("/discover"),
    },
    { to: "/me", label: "我的", icon: "person", active: pathname.startsWith("/me") },
  ];
  const desktopNavItems: NavItem[] = navItems.filter((item) => item.to !== "/me");
  const profileMenuItems: MenuItem[] = [
    {
      to: "/me",
      label: "设置",
      icon: "settings",
      active: pathname === "/me",
    },
    {
      to: "/me/tasks",
      label: "下载",
      icon: "download",
      active: pathname.startsWith("/me/tasks"),
    },
    {
      to: "/me/favorites",
      label: "收藏",
      icon: "favorite",
      active: pathname.startsWith("/me/favorites"),
    },
  ];
  const shellClassName = [
    "app-shell",
    shellImmersive ? "app-shell--immersive" : "",
    "app-shell--site",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClassName}>
      <header className="app-topbar app-topbar--site">
        <div className="app-container app-topbar__row">
          <Link className="app-brand" prefetch="intent" to="/">
            <span className="app-brand__mono">JM</span>
            <span className="app-brand__copy">
              <span className="app-brand__title">{props.title ?? "Aura"}</span>
              <span className="app-brand__subtitle">
                {props.subtitle ?? "继续阅读优先"}
              </span>
            </span>
          </Link>

          <nav className="app-topbar__desktop-nav" aria-label="桌面主导航">
            {desktopNavItems.map((item) => (
              <Link
                key={item.to}
                className={`app-desktop-nav-link${item.active ? " app-desktop-nav-link--active" : ""}`}
                prefetch="intent"
                to={item.to}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="app-topbar__desktop-tools">
            {searchSlot}

            <details className="app-profile-menu">
              <summary
                className="app-avatar-button"
                aria-haspopup="menu"
                aria-label="打开个人菜单"
              >
                <span className="app-avatar-button__badge" aria-hidden="true">
                  我
                </span>
                <span className="material-symbols-rounded" aria-hidden="true">
                  expand_more
                </span>
              </summary>
              <div className="app-avatar-menu" role="menu">
                {profileMenuItems.map((item) => (
                  <Link
                    key={item.to}
                    className={`app-avatar-menu__item${item.active ? " app-avatar-menu__item--active" : ""}`}
                    prefetch="intent"
                    role="menuitem"
                    to={item.to}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </details>
          </div>

          <div className="app-topbar__actions app-topbar__actions--mobile">
            {props.actions}

            <button
              type="button"
              className="md-button md-button--surface app-control-button"
              onClick={() => setTheme(nextTheme)}
              aria-label={`切换到${nextTheme === "light" ? "浅色" : "深色"}主题`}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                {theme === "dark" ? "light_mode" : "dark_mode"}
              </span>
              <span className="app-control-button__label">
                {theme === "dark" ? "浅色" : "深色"}
              </span>
            </button>

            <button
              type="button"
              className="md-button md-button--surface app-control-button"
              onClick={() => setShellImmersive((value) => !value)}
              aria-pressed={shellImmersive}
              aria-label={shellImmersive ? "退出沉浸布局" : "开启沉浸布局"}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                {shellImmersive ? "fullscreen_exit" : "fullscreen"}
              </span>
              <span className="app-control-button__label">
                {shellImmersive ? "退出沉浸" : "沉浸布局"}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="app-container app-main__inner app-main__inner--site">{props.children}</div>
      </main>

      <div
        className={`app-nav-progress${progress.visible ? " app-nav-progress--visible" : ""}`}
        aria-hidden="true"
      >
        <span
          className="app-nav-progress__bar"
          style={{ transform: `scaleX(${progress.value})` }}
        />
      </div>

      <nav className="app-bottom-nav app-bottom-nav--mobile" aria-label="主导航">
        <div className="app-container app-bottom-nav__row">
          {navItems.map((item) => (
            <Link
              key={item.to}
              className={`app-nav-link${item.active ? " app-nav-link--active" : ""}`}
              prefetch="intent"
              to={item.to}
            >
              <span className="app-nav-link__icon-shell">
                <span className="material-symbols-rounded" aria-hidden="true">
                  {item.icon}
                </span>
              </span>
              <span className="app-nav-link__label">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      {shellImmersive ? (
        <button
          type="button"
          className="md-button md-button--primary app-shell-fab"
          onClick={() => setShellImmersive(false)}
          aria-label="退出沉浸布局"
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            visibility
          </span>
          <span>显示导航</span>
        </button>
      ) : null}
    </div>
  );
}
