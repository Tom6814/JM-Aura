import test from "node:test";
import assert from "node:assert/strict";

import { createEmptyHomeSections, mapHomeFeedToSections } from "./home.server";

test("mapHomeFeedToSections promotes continue-reading and ranking rails", () => {
  const result = mapHomeFeedToSections({
    latest: {
      content: [{ id: "100", name: "最新作品", tags: [], author: null, description: null, image: null }],
      total: 1,
      page_size: 80,
      page_count: 1,
    },
    rankings: {
      today: {
        content: [{ id: "200", name: "今日榜", tags: [], author: null, description: null, image: null }],
        total: 1,
        page_size: 80,
        page_count: 1,
      },
      week: { content: [], total: 0, page_size: 80, page_count: 0 },
      month: { content: [], total: 0, page_size: 80, page_count: 0 },
    },
  });

  assert.equal(result.latest[0]?.id, "100");
  assert.equal(result.rankings.today[0]?.id, "200");
  assert.equal(result.featured?.id, "100");
  assert.equal(result.featuredSource, "latest");
  assert.deepEqual(
    result.entryPoints.map((item) => item.key),
    ["latest", "hot", "categories"],
  );
});

test("mapHomeFeedToSections falls back to rankings when latest is empty", () => {
  const result = mapHomeFeedToSections({
    latest: { content: [], total: 0, page_size: 80, page_count: 0 },
    rankings: {
      today: {
        content: [{ id: "220", name: "今日榜", tags: [], author: null, description: null, image: null }],
        total: 1,
        page_size: 80,
        page_count: 1,
      },
      week: {
        content: [{ id: "320", name: "本周榜", tags: [], author: null, description: null, image: null }],
        total: 1,
        page_size: 80,
        page_count: 1,
      },
      month: { content: [], total: 0, page_size: 80, page_count: 0 },
    },
  });

  assert.equal(result.featured?.id, "220");
  assert.equal(result.featuredSource, "today");
});

test("mapHomeFeedToSections keeps empty ranking rails stable", () => {
  const result = mapHomeFeedToSections({
    latest: { content: [], total: 0, page_size: 80, page_count: 0 },
    rankings: {
      today: { content: [], total: 0, page_size: 80, page_count: 0 },
      week: { content: [], total: 0, page_size: 80, page_count: 0 },
      month: { content: [], total: 0, page_size: 80, page_count: 0 },
    },
  });

  assert.equal(result.featured, null);
  assert.equal(result.featuredSource, "latest");
  assert.deepEqual(result.rankings.today, []);
});

test("createEmptyHomeSections keeps home shell stable when upstream fails", () => {
  const result = createEmptyHomeSections();

  assert.equal(result.featured, null);
  assert.equal(result.featuredSource, "latest");
  assert.deepEqual(result.latest, []);
  assert.deepEqual(result.rankings.today, []);
  assert.deepEqual(result.rankings.week, []);
  assert.deepEqual(result.rankings.month, []);
  assert.deepEqual(result.entryPoints, [
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
  ]);
});
