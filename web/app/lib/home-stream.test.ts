import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHistoryContinueReadingSegment,
  createHomeStreamPayload,
  getHomeStreamSectionMeta,
  getHomeStreamCacheKey,
  resolveContinueReadingSegment,
} from "./home-stream";

test("getHomeStreamCacheKey keeps latest and rankings isolated", () => {
  assert.equal(getHomeStreamCacheKey("latest", ""), "home:latest:");
  assert.equal(getHomeStreamCacheKey("ranking-week", ""), "home:ranking-week:");
});

test("createHomeStreamPayload exposes five independent sections", async () => {
  const payload = createHomeStreamPayload({
    continueReading: async () => ({
      item: null,
      sourceLabel: "最新更新",
      href: "/search?order_by=mr",
      actionLabel: "看最新",
    }),
    latest: async () => [{ id: "1", name: "最新", tags: [], author: null, description: null, image: null }],
    rankingToday: async () => [],
    rankingWeek: async () => [],
    rankingMonth: async () => [],
  });

  assert.ok(payload.continueReading);
  assert.ok(payload.latest);
  assert.ok(payload.rankingToday);
  assert.ok(payload.rankingWeek);
  assert.ok(payload.rankingMonth);
});

test("getHomeStreamSectionMeta returns stable loading and retry copy", () => {
  assert.deepEqual(getHomeStreamSectionMeta("latest"), {
    queryValue: "latest",
    title: "最新更新",
    loadingTitle: "最新更新正在同步",
    loadingDescription: "当前区块会在数据返回后独立填充。",
    errorTitle: "最新更新加载失败",
    errorDescription: "当前区块没有同步成功。",
    retryLabel: "重试当前区块",
  });

  assert.deepEqual(getHomeStreamSectionMeta("rankingMonth"), {
    queryValue: "ranking-month",
    title: "本月热门",
    loadingTitle: "本月热门正在同步",
    loadingDescription: "当前区块会在数据返回后独立填充。",
    errorTitle: "本月热门加载失败",
    errorDescription: "当前区块没有同步成功。",
    retryLabel: "重试当前区块",
  });
});

test("createHomeStreamPayload keeps retryable segment descriptors stable", async () => {
  const payload = createHomeStreamPayload({
    continueReading: async () => ({
      item: null,
      sourceLabel: "最新更新",
      href: "/search?order_by=mr",
      actionLabel: "看最新",
    }),
    latest: async () => [],
    rankingToday: async () => [],
    rankingWeek: async () => [],
    rankingMonth: async () => [],
  });

  assert.equal(typeof payload.latest.then, "function");
  assert.equal(typeof payload.rankingMonth.then, "function");
});

test("resolveContinueReadingSegment falls back across sections", async () => {
  const segment = await resolveContinueReadingSegment({
    latest: async () => [],
    rankingToday: async () => [],
    rankingWeek: async () => [
      {
        id: "42",
        name: "本周榜首",
        tags: [],
        author: null,
        description: null,
        image: null,
      },
    ],
    rankingMonth: async () => [],
  });

  assert.equal(segment.item?.id, "42");
  assert.equal(segment.sourceLabel, "本周热门");
});

test("buildHistoryContinueReadingSegment points continue reading to the stored chapter", () => {
  const segment = buildHistoryContinueReadingSegment(
    {
      mangaId: "438696",
      chapterId: "147700",
      progress: 0.4,
    },
    {
      album_id: "438696",
      name: "历史漫画",
      image: "https://img.example.com/cover.jpg",
      author: "测试作者",
      tags: ["校园", "恋爱"],
    },
  );

  assert.deepEqual(segment, {
    item: {
      id: "438696",
      name: "历史漫画",
      tags: ["校园", "恋爱"],
      author: "测试作者",
      description: null,
      image: "https://img.example.com/cover.jpg",
    },
    sourceLabel: "上次读到",
    href: "/chapter/147700",
    actionLabel: "继续阅读",
  });
});

test("buildHistoryContinueReadingSegment ignores mismatched manga ids", () => {
  const segment = buildHistoryContinueReadingSegment(
    {
      mangaId: "100",
      chapterId: "200",
      progress: 0.2,
    },
    {
      album_id: "999",
      name: "别的漫画",
      image: null,
      author: "",
      tags: [],
    },
  );

  assert.equal(segment, null);
});
