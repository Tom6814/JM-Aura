import assert from "node:assert/strict";
import test from "node:test";

import { parseMangaDetailView, shouldSkipMangaDetailRevalidation } from "./manga-detail-navigation";

test("parseMangaDetailView normalizes tab order and page", () => {
  assert.deepEqual(
    parseMangaDetailView("http://localhost/manga/1?tab=comments&order=desc&page=3"),
    {
      tab: "comments",
      order: "desc",
      page: 3,
    },
  );
});

test("parseMangaDetailView falls back for invalid values", () => {
  assert.deepEqual(
    parseMangaDetailView("http://localhost/manga/1?tab=unknown&order=bad&page=0"),
    {
      tab: "content",
      order: "asc",
      page: 1,
    },
  );
});

test("shouldSkipMangaDetailRevalidation returns true for same-path UI-only query changes", () => {
  assert.equal(
    shouldSkipMangaDetailRevalidation(
      "http://localhost/manga/1?tab=content&order=asc",
      "http://localhost/manga/1?tab=comments&order=desc&page=2",
    ),
    true,
  );
});

test("shouldSkipMangaDetailRevalidation returns false when path changes", () => {
  assert.equal(
    shouldSkipMangaDetailRevalidation(
      "http://localhost/manga/1?tab=content",
      "http://localhost/manga/2?tab=content",
    ),
    false,
  );
});

test("shouldSkipMangaDetailRevalidation returns false for non-UI search params", () => {
  assert.equal(
    shouldSkipMangaDetailRevalidation(
      "http://localhost/manga/1?tab=content",
      "http://localhost/manga/1?tab=comments&comments-resource=1",
    ),
    false,
  );
});

