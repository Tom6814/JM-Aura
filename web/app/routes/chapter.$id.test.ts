import assert from "node:assert/strict";
import test from "node:test";

import {
  getChapterNavigationPendingMessage,
  loader as chapterLoader,
  readerRouteLoaderDependencies,
  shouldBeginChapterNavigationFeedback,
} from "./chapter.$id";

test("chapter loader resolves chapter and manga eagerly", async () => {
  const originalFetchChapter = readerRouteLoaderDependencies.fetchChapter;
  const originalFetchManga = readerRouteLoaderDependencies.fetchManga;
  const originalGetApiOrigin = readerRouteLoaderDependencies.getApiOrigin;

  readerRouteLoaderDependencies.fetchChapter = async () =>
    ({
      id: "c1",
      photo_id: "c1",
      album_id: "a1",
      scramble_id: "220980",
      name: "第一话",
      series_id: "0",
      sort: "1",
      tags: "",
      works: [],
      actors: [],
      related_list: [],
      liked: false,
      is_favorite: false,
      images: [],
      image_list: [],
      series: [],
    }) as any;
  readerRouteLoaderDependencies.fetchManga = async () =>
    ({
      album_id: "a1",
      scramble_id: "0",
      name: "测试漫画",
      image: null,
      description: "",
      page_count: 1,
      pub_date: "0",
      update_date: "0",
      likes: "0",
      views: "0",
      comment_count: 0,
      works: [],
      actors: [],
      authors: [],
      author: "",
      tags: [],
      episode_list: [{ photo_id: "c1", sort: "1", name: "第一话" }],
      related_list: [],
      liked: false,
      is_favorite: false,
    }) as any;
  readerRouteLoaderDependencies.getApiOrigin = () => "http://localhost:8787";

  try {
    const response = await chapterLoader({
      params: { id: "c1" },
      request: new Request("http://localhost/chapter/c1"),
      context: {},
    } as any);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      apiOrigin: "http://localhost:8787",
      chapter: {
        id: "c1",
        photo_id: "c1",
        album_id: "a1",
        scramble_id: "220980",
        name: "第一话",
        series_id: "0",
        sort: "1",
        tags: "",
        works: [],
        actors: [],
        related_list: [],
        liked: false,
        is_favorite: false,
        images: [],
        image_list: [],
        series: [],
      },
      manga: {
        album_id: "a1",
        scramble_id: "0",
        name: "测试漫画",
        image: null,
        description: "",
        page_count: 1,
        pub_date: "0",
        update_date: "0",
        likes: "0",
        views: "0",
        comment_count: 0,
        works: [],
        actors: [],
        authors: [],
        author: "",
        tags: [],
        episode_list: [{ photo_id: "c1", sort: "1", name: "第一话" }],
        related_list: [],
        liked: false,
        is_favorite: false,
      },
    });
  } finally {
    readerRouteLoaderDependencies.fetchChapter = originalFetchChapter;
    readerRouteLoaderDependencies.fetchManga = originalFetchManga;
    readerRouteLoaderDependencies.getApiOrigin = originalGetApiOrigin;
  }
});

test("chapter navigation feedback starts only for plain primary clicks", () => {
  assert.equal(
    shouldBeginChapterNavigationFeedback({
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    }),
    true,
  );

  assert.equal(
    shouldBeginChapterNavigationFeedback({
      defaultPrevented: false,
      button: 1,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    }),
    false,
  );

  assert.equal(
    shouldBeginChapterNavigationFeedback({
      defaultPrevented: false,
      button: 0,
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    }),
    false,
  );
});

test("chapter navigation feedback message escalates when navigation is slow", () => {
  assert.equal(getChapterNavigationPendingMessage("previous", false), "正在进入上一话…");
  assert.equal(getChapterNavigationPendingMessage("next", false), "正在进入下一话…");
  assert.equal(getChapterNavigationPendingMessage("next", true), "章节切换较慢，请稍等…");
});
