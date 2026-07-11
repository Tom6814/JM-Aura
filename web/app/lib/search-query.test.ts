import test from "node:test";
import assert from "node:assert/strict";

import { parseSearchParams } from "./search-query";

test("parseSearchParams reads extended search filters from URL", () => {
  const params = new URLSearchParams({
    keyword: "MANA",
    page: "3",
    main_tag: "2",
    order_by: "mv",
    time: "m",
  });

  assert.deepEqual(parseSearchParams(params), {
    keyword: "MANA",
    page: 3,
    main_tag: 2,
    order_by: "mv",
    time: "m",
  });
});

test("parseSearchParams falls back to defaults for invalid values", () => {
  const params = new URLSearchParams({
    keyword: "  artist  ",
    page: "-8",
    main_tag: "999",
    order_by: "invalid",
    time: "year",
  });

  assert.deepEqual(parseSearchParams(params), {
    keyword: "artist",
    page: 1,
    main_tag: 0,
    order_by: "mr",
    time: "a",
  });
});

test("parseSearchParams keeps keyword and normalizes defaults for compact search UI", () => {
  const result = parseSearchParams(new URLSearchParams({ keyword: "orange" }));

  assert.equal(result.keyword, "orange");
  assert.equal(result.main_tag, 0);
  assert.equal(result.order_by, "mr");
  assert.equal(result.time, "a");
});

test("parseSearchParams resets page when compact search UI has no keyword", () => {
  const result = parseSearchParams(
    new URLSearchParams({
      keyword: "   ",
      page: "5",
      main_tag: "2",
      order_by: "tf",
      time: "m",
    }),
  );

  assert.equal(result.keyword, "");
  assert.equal(result.page, 1);
  assert.equal(result.main_tag, 2);
  assert.equal(result.order_by, "tf");
  assert.equal(result.time, "m");
});

test("parseSearchParams prefers q and keeps compact search filters", () => {
  const result = parseSearchParams(
    new URLSearchParams({
      q: "  orange  ",
      keyword: "legacy",
      page: "2",
      main_tag: "3",
      order_by: "mv",
      time: "w",
    }),
  );

  assert.deepEqual(result, {
    keyword: "orange",
    page: 2,
    main_tag: 3,
    order_by: "mv",
    time: "w",
  });
});

test("parseSearchParams falls back to legacy keyword when q is missing", () => {
  const result = parseSearchParams(
    new URLSearchParams({
      keyword: "legacy keyword",
      page: "4",
    }),
  );

  assert.equal(result.keyword, "legacy keyword");
  assert.equal(result.page, 4);
});
