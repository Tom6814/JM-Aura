import test from "node:test";
import assert from "node:assert/strict";

import { buildDiscoverHref, parseDiscoverParams } from "./discover-query";

test("parseDiscoverParams normalizes category sub_category and ranking mode", () => {
  const params = new URLSearchParams({
    category: "doujin",
    sub_category: "CG",
    order_by: "mv",
    time: "a",
  });

  assert.deepEqual(parseDiscoverParams(params), {
    category: "doujin",
    sub_category: "CG",
    order_by: "mv",
    time: "a",
    page: 1,
  });
});

test("parseDiscoverParams falls back for invalid filters and page", () => {
  const params = new URLSearchParams({
    category: "unknown",
    sub_category: "   ",
    order_by: "nope",
    time: "year",
    page: "-4",
  });

  assert.deepEqual(parseDiscoverParams(params), {
    category: "",
    sub_category: undefined,
    order_by: "mv",
    time: "a",
    page: 1,
  });
});

test("buildDiscoverHref preserves category while toggling sub_category from drawer", () => {
  const href = buildDiscoverHref(
    { sub_category: "CG", page: 1 },
    { category: "doujin", sub_category: undefined, order_by: "mv", time: "a", page: 2 },
  );

  assert.equal(href, "/discover?category=doujin&sub_category=CG&order_by=mv&time=a&page=1");
});
