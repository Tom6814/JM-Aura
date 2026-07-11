import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import type { SearchResultItem } from "../../../packages/shared/src/schema";
import type { HomeEntryPoint } from "../lib/home.server";
import { HomeReadingHub } from "./home";
import { HomeGridSkeleton } from "./loading";

const baseItem: SearchResultItem = {
  id: "438696",
  name: "测试漫画",
  tags: ["校园", "恋爱"],
  author: "测试作者",
  description: null,
  image: null,
};

const entryPoints: HomeEntryPoint[] = [
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

test("HomeReadingHub migrates the first screen to SiteToolbar and keeps continue reading in the shared aside", async () => {
  const markup = await renderHomeMarkup();

  assert.match(markup, /class="site-toolbar home-site-toolbar"/);
  assert.doesNotMatch(markup, /class="home-toolbar"/);
  assert.match(markup, /class="site-toolbar__aside"[\s\S]*class="home-continue-mini"/);
  assert.match(markup, /JM-Aura-Remix/);
  assert.doesNotMatch(markup, /直接开看今天想读的内容/);
  assert.doesNotMatch(markup, /搜索、热门入口和继续阅读都收在首屏/);
  assert.doesNotMatch(markup, /首页/);
  assert.match(markup, /搜索标题、作者、ID/);
});

test("HomeReadingHub renders latest updates through MediaGrid home density classes", async () => {
  const markup = await renderHomeMarkup();

  assert.match(markup, /class="media-grid media-grid--default media-grid--home"/);
  assert.doesNotMatch(markup, /class="home-grid"/);
  assert.match(markup, /class="home-card"/);
});

test("HomeGridSkeleton uses the shared MediaGrid home layout while data is pending", () => {
  const markup = renderToStaticMarkup(
    <HomeGridSkeleton count={6} title="最新更新" description="正在同步" />,
  );

  assert.match(markup, /class="media-grid media-grid--default media-grid--home media-grid--skeleton"/);
  assert.doesNotMatch(markup, /class="home-grid"/);
});

test("ContinueReadingMini removes redundant meta copy and keeps author chips above actions", async () => {
  const markup = await renderHomeMarkup();

  assert.doesNotMatch(markup, /home-continue-mini__meta/);
  assert.match(markup, /home-continue-mini__tags[\s\S]*作者：[\s\S]*测试作者/);
  assert.match(markup, /home-continue-mini__tags[\s\S]*home-continue-mini__actions/);
});

test("HomeReadingHub uses continue-reading href and action label from the resolved segment", async () => {
  const markup = await renderHomeMarkup();

  assert.match(markup, /class="home-continue-mini__title"[^>]*href="\/manga\/438696"/);
  assert.match(markup, /class="md-button md-button--primary"[^>]*href="\/manga\/438696"[\s\S]*继续/);
});

test("HomeReadingHub quick search uses GET and q for URL-driven search navigation", async () => {
  const markup = await renderHomeMarkup();

  assert.match(markup, /<form[^>]*class="home-inline-search"/);
  assert.match(markup, /<form[^>]*action="\/search"/);
  assert.match(markup, /<form[^>]*method="get"/);
  assert.match(markup, /class="md-search-bar__input"[^>]*name="q"/);
  assert.doesNotMatch(markup, /class="home-inline-search"[\s\S]*name="keyword"/);
});

async function renderHomeMarkup() {
  return withSuppressedRouterWarnings(async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <HomeReadingHub
              apiOrigin="https://example.com"
              entryPoints={entryPoints}
              stream={{
                continueReading: Promise.resolve({
                  item: baseItem,
                  sourceLabel: "最新更新",
                  href: "/manga/438696",
                  actionLabel: "继续",
                }),
                latest: Promise.resolve(
                  Array.from({ length: 12 }, (_, index) => ({
                    ...baseItem,
                    id: `${438696 + index}`,
                    name: `测试漫画 ${index + 1}`,
                  })),
                ),
                rankingToday: Promise.resolve([baseItem]),
                rankingWeek: Promise.resolve([baseItem]),
                rankingMonth: Promise.resolve([baseItem]),
              }}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );

    return await new Promise<string>((resolve, reject) => {
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
