import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import { AppChrome } from "./chrome";
import * as ui from "./ui";

const { MediaGrid, SiteToolbar } = ui as {
  MediaGrid?: (props: {
    children: ReactNode;
    variant?: "default" | "directory";
    className?: string;
  }) => ReactElement;
  SiteToolbar?: (props: {
    eyebrow?: string;
    title: string;
    description?: string;
    children?: ReactNode;
    aside?: ReactNode;
    className?: string;
  }) => ReactElement;
};

test("ui barrel exports SiteToolbar and MediaGrid", () => {
  assert.equal(typeof SiteToolbar, "function");
  assert.equal(typeof MediaGrid, "function");
});

test("SiteToolbar renders shared intro and aside slots", () => {
  assert.ok(SiteToolbar, "SiteToolbar should be exported from the ui barrel");

  const markup = renderToStaticMarkup(
    <SiteToolbar
      eyebrow="发现"
      title="目录"
      description="分类导航与筛选工具"
      aside={<button type="button">筛选</button>}
    >
      <a href="/latest">最新</a>
      <a href="/ranking">热门</a>
    </SiteToolbar>,
  );

  assert.match(markup, /class="site-toolbar"/);
  assert.match(markup, /class="site-toolbar__body"/);
  assert.match(markup, /class="site-toolbar__aside"/);
  assert.match(markup, /section-header__title">目录</);
  assert.match(markup, /筛选/);
  assert.match(markup, /最新/);
  assert.match(markup, /热门/);
});

test("MediaGrid renders directory modifier class for shared responsive layout", () => {
  assert.ok(MediaGrid, "MediaGrid should be exported from the ui barrel");

  const markup = renderToStaticMarkup(
    <MediaGrid variant="directory">
      <article>一</article>
      <article>二</article>
      <article>三</article>
    </MediaGrid>,
  );

  assert.match(markup, /class="media-grid media-grid--directory"/);
  assert.match(markup, /<article>一<\/article>/);
  assert.match(markup, /<article>二<\/article>/);
  assert.match(markup, /<article>三<\/article>/);
});

test("AppChrome 桌面顶栏渲染三段式主导航与头像菜单，手机端底栏保持“我的”入口", async () => {
  const markup = await withSuppressedRouterWarnings(() =>
    renderWithRouter(
      <AppChrome>
        <div>content</div>
      </AppChrome>,
      "/search",
    ),
  );

  assert.match(markup, /class="app-topbar__desktop-nav" aria-label="桌面主导航"/);
  assert.match(markup, /class="app-desktop-nav-link app-desktop-nav-link--active"[^>]*>搜索<\/a>/);
  assert.match(markup, /class="app-desktop-nav-link"[^>]*>首页<\/a>/);
  assert.match(markup, /class="app-desktop-nav-link"[^>]*>发现<\/a>/);
  assert.doesNotMatch(markup, /class="app-topbar__desktop-nav"[\s\S]*?>[\s\S]*?>我的<\/a>/);
  assert.match(markup, /class="app-avatar-menu__item"[^>]*href="\/me"[\s\S]*?<span>设置<\/span><\/a>/);
  assert.match(markup, /class="app-avatar-menu__item"[^>]*href="\/me\/tasks"[\s\S]*?<span>下载<\/span><\/a>/);
  assert.match(markup, /class="app-avatar-menu__item"[^>]*href="\/me\/favorites"[\s\S]*?<span>收藏<\/span><\/a>/);
  assert.match(markup, /class="app-nav-link"[\s\S]*?>[\s\S]*?<span class="app-nav-link__label">我的<\/span>/);
});

async function renderWithRouter(element: ReactNode, initialEntry = "/") {
  return await new Promise<string>((resolve, reject) => {
    const router = createMemoryRouter(
      [
        {
          id: "root",
          path: "*",
          element,
        },
      ],
      { initialEntries: [initialEntry] },
    );

    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });

    const stream = renderToPipeableStream(<RouterProvider router={router} />, {
      onAllReady() {
        stream.pipe(writable);
      },
      onError(error) {
        reject(error);
      },
    });

    writable.on("finish", () => resolve(Buffer.concat(chunks).toString("utf8")));
    writable.on("error", reject);
  });
}

async function withSuppressedRouterWarnings<T>(callback: () => Promise<T>) {
  const originalConsoleError = console.error;

  console.error = (...args: unknown[]) => {
    const [firstArg] = args;
    if (
      typeof firstArg === "string" &&
      firstArg.includes("useLayoutEffect does nothing on the server")
    ) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    return await callback();
  } finally {
    console.error = originalConsoleError;
  }
}
