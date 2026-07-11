import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import type { ReactNode } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import type { CategoryResult, SearchResultItem } from "../../../packages/shared/src/schema";
import { DiscoverExplorer } from "./discover";
import { SearchCatalogPage } from "../routes/search";

const baseItem: SearchResultItem = {
  id: "438696",
  name: "测试漫画",
  tags: ["校园", "恋爱"],
  author: "测试作者",
  description: null,
  image: null,
};

test("SearchCatalogPage uses shared catalog toolbar and result-first media grid layout", async () => {
  const markup = await renderWithRouter(
    <SearchCatalogPage
      data={{
        apiOrigin: "https://example.com",
        keyword: "测试",
        page: 1,
        main_tag: 0,
        order_by: "mr",
        time: "a",
        result: {
          total: 1,
          content: [baseItem],
          page_size: 80,
          page_count: 1,
          is_single_album: false,
          single_album: null,
        },
        error: null,
      }}
      isSearching={false}
    />,
  );

  assert.match(markup, /class="catalog-page catalog-page--search"/);
  assert.match(markup, /class="catalog-page__results"/);
  assert.match(markup, /class="site-toolbar catalog-toolbar"/);
  assert.match(markup, /class="media-grid media-grid--directory catalog-grid"/);
  assert.doesNotMatch(markup, /search-results__grid/);
  assert.doesNotMatch(markup, /compact-panel search-toolbar/);
  assert.ok(markup.indexOf("catalog-toolbar") < markup.indexOf("catalog-page__results"));
  assert.doesNotMatch(markup, /去发现页/);
});

test("SearchCatalogPage uses q across search form, filters, and pagination links", async () => {
  const markup = await renderWithRouter(
    <SearchCatalogPage
      data={{
        apiOrigin: "https://example.com",
        keyword: "测试",
        page: 2,
        main_tag: 3,
        order_by: "mv",
        time: "w",
        result: {
          total: 3,
          content: [baseItem],
          page_size: 80,
          page_count: 3,
          is_single_album: false,
          single_album: null,
        },
        error: null,
      }}
      isSearching={false}
    />,
  );

  assert.match(markup, /<form[^>]*class="catalog-search-form"/);
  assert.match(markup, /<form[^>]*method="get"/);
  assert.match(markup, /class="catalog-search-form"[\s\S]*name="q"/);
  assert.doesNotMatch(markup, /class="catalog-search-form"[\s\S]*name="keyword"/);
  assert.match(markup, /type="hidden" name="q" value="测试"/);
  assert.match(markup, /href="\/search\?q=%E6%B5%8B%E8%AF%95&amp;page=1&amp;main_tag=3&amp;order_by=mv&amp;time=w"/);
  assert.match(markup, /href="\/search\?q=%E6%B5%8B%E8%AF%95&amp;page=3&amp;main_tag=3&amp;order_by=mv&amp;time=w"/);
});

test("DiscoverExplorer reuses the same catalog layout and directory grid density", async () => {
  const result: CategoryResult = {
    content: [
      baseItem,
      {
        ...baseItem,
        id: "438697",
        name: "第二本测试漫画",
      },
    ],
    page_size: 80,
    page_count: 3,
    total: 2,
  };

  const markup = await renderWithRouter(
    <DiscoverExplorer
      apiOrigin="https://example.com"
      query={{
        category: "doujin",
        sub_category: "CG",
        page: 1,
        order_by: "mv",
        time: "a",
      }}
      result={result}
      error={null}
    />,
  );

  assert.match(markup, /class="catalog-page"/);
  assert.match(markup, /class="catalog-page__results"/);
  assert.match(markup, /class="site-toolbar catalog-toolbar"/);
  assert.match(markup, /class="media-grid media-grid--directory catalog-grid"/);
  assert.doesNotMatch(markup, /discover-grid/);
  assert.doesNotMatch(markup, /compact-panel discover-toolbar/);
  assert.ok(markup.indexOf("catalog-toolbar") < markup.indexOf("catalog-page__results"));
});

async function renderWithRouter(element: ReactNode) {
  return withSuppressedRouterWarnings(async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element,
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
