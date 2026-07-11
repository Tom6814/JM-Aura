import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import type { ReactNode } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import { AppChrome } from "./chrome";

test("AppChrome desktop topbar search submits q through GET to the search page", async () => {
  const markup = await withSuppressedRouterWarnings(() =>
    renderWithRouter(
      <AppChrome>
        <div>内容</div>
      </AppChrome>,
    ),
  );

  assert.match(markup, /<form[^>]*class="app-topbar__search"/);
  assert.match(markup, /<form[^>]*action="\/search"/);
  assert.match(markup, /<form[^>]*method="get"/);
  assert.match(markup, /class="md-search-bar__input"[^>]*name="q"/);
  assert.doesNotMatch(markup, /name="keyword"/);
});

async function renderWithRouter(element: ReactNode) {
  return await new Promise<string>((resolve, reject) => {
    const router = createMemoryRouter(
      [
        {
          id: "root",
          path: "/search",
          element,
        },
      ],
      { initialEntries: ["/search"] },
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
