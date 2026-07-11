import assert from "node:assert/strict";
import test from "node:test";

import type { FetchFavoritesInput } from "../lib/jm-rpc.server";
import {
  action as mangaDetailAction,
  loader as mangaDetailLoader,
  mangaDetailActionDependencies,
  mangaDetailRouteDependencies,
  mangaDetailLoaderDependencies,
  shouldAutoCloseDownloadPicker,
  shouldAutoCloseFavoritePicker,
} from "./manga.$id";
import {
  favoriteFoldersRouteDependencies,
  loader as favoriteFoldersLoader,
} from "./manga.$id.favorite-folders";

test("manga detail favorite action forwards selected folder_id", async () => {
  const originalAddFavorite = mangaDetailRouteDependencies.addFavorite;
  let capturedFolderId: string | null = null;

  mangaDetailRouteDependencies.addFavorite = async (_request: Request, _albumId: string, folderId?: string) => {
    capturedFolderId = folderId ?? null;
    return { success: true, album_id: "438696" };
  };

  try {
    const request = new Request("http://localhost/manga/438696", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        intent: "favorite",
        folder_id: "42",
      }),
    });

    const response = await mangaDetailAction({
      params: { id: "438696" },
      request,
      context: {},
    } as any);

    assert.equal(response.status, 200);
    assert.equal(capturedFolderId, "42");
  } finally {
    mangaDetailRouteDependencies.addFavorite = originalAddFavorite;
  }
});

test("favorite folders resource returns folder_list only", async () => {
  const originalFetchFavorites = favoriteFoldersRouteDependencies.fetchFavorites;
  let capturedInput: FetchFavoritesInput | null = null;

  favoriteFoldersRouteDependencies.fetchFavorites = async (_request, input) => {
    capturedInput = input ?? null;
    return ({
    list: [],
    folder_list: [
      { FID: "0", name: "默认收藏夹" },
      { FID: "42", name: "待补档" },
    ],
    total: 0,
    page_size: 20,
    page_count: 0,
    });
  };

  try {
    const response = await favoriteFoldersLoader({
      params: { id: "438696" },
      request: new Request("http://localhost/manga/438696/favorite-folders"),
      context: {},
    } as any);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      folders: [
        { FID: "0", name: "默认收藏夹" },
        { FID: "42", name: "待补档" },
      ],
    });
    assert.deepEqual(capturedInput, {
      page: 1,
      folder_id: "0",
      page_size: 10,
    });
  } finally {
    favoriteFoldersRouteDependencies.fetchFavorites = originalFetchFavorites;
  }
});

test("shouldAutoCloseFavoritePicker only closes after successful favorite action", () => {
  assert.equal(shouldAutoCloseFavoritePicker(undefined), false);
  assert.equal(shouldAutoCloseFavoritePicker({ intent: "favorite", ok: false, message: "收藏失败" }), false);
  assert.equal(shouldAutoCloseFavoritePicker({ intent: "download_selected", ok: true, message: "任务已创建" }), false);
  assert.equal(shouldAutoCloseFavoritePicker({ intent: "favorite", ok: true, message: "已加入收藏夹" }), true);
});

test("shouldAutoCloseDownloadPicker only closes after successful download action", () => {
  assert.equal(shouldAutoCloseDownloadPicker(undefined), false);
  assert.equal(shouldAutoCloseDownloadPicker({ intent: "favorite", ok: true, message: "已加入收藏夹" }), false);
  assert.equal(shouldAutoCloseDownloadPicker({ intent: "download_selected", ok: false, message: "请选择章节" }), false);
  assert.equal(shouldAutoCloseDownloadPicker({ intent: "download_selected", ok: true, message: "下载任务已创建" }), true);
});

test("manga detail loader resolves data eagerly instead of returning pending promises", async () => {
  const originalFetchManga = mangaDetailLoaderDependencies.fetchManga;
  const originalFetchTaskList = mangaDetailLoaderDependencies.fetchTaskList;
  const originalGetApiOrigin = mangaDetailLoaderDependencies.getApiOrigin;

  mangaDetailLoaderDependencies.fetchManga = async () =>
    ({
      album_id: "438696",
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
      episode_list: [],
      related_list: [],
      liked: false,
      is_favorite: false,
    }) as any;
  mangaDetailLoaderDependencies.fetchTaskList = async () => [];
  mangaDetailLoaderDependencies.getApiOrigin = () => "http://localhost:8787";

  try {
    const response = await mangaDetailLoader({
      params: { id: "438696" },
      request: new Request("http://localhost/manga/438696"),
      context: {},
    } as any);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      apiOrigin: "http://localhost:8787",
      manga: {
        album_id: "438696",
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
        episode_list: [],
        related_list: [],
        liked: false,
        is_favorite: false,
      },
      tasks: [],
    });
  } finally {
    mangaDetailLoaderDependencies.fetchManga = originalFetchManga;
    mangaDetailLoaderDependencies.fetchTaskList = originalFetchTaskList;
    mangaDetailLoaderDependencies.getApiOrigin = originalGetApiOrigin;
  }
});

test("manga detail download action forwards selected chapter_ids and selected chapter details", async () => {
  const originalCreateAlbumExportTask = mangaDetailActionDependencies.createAlbumExportTask;
  let capturedInput: {
    albumId: string;
    chapterIds?: string[];
    selectedChapters?: Array<{ chapterId: string; chapterTitle?: string | null; chapterSort?: string | null }>;
  } | null = null;

  mangaDetailActionDependencies.createAlbumExportTask = async (_request, input) => {
    capturedInput = input;
    return {
      id: "task-1",
      type: "export_album_zip",
      status: "queued",
      createdAt: Date.now(),
      progress: { total: null, current: 0, currentLabel: null },
    };
  };

  try {
    const request = new Request("http://localhost/manga/438696", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["intent", "download_selected"],
        ["chapter_ids", "c2"],
        ["chapter_ids", "c4"],
        ["selected_chapters", JSON.stringify({ chapterId: "c2", chapterTitle: "第 2 话", chapterSort: "2" })],
        ["selected_chapters", JSON.stringify({ chapterId: "c4", chapterTitle: "番外", chapterSort: "4" })],
      ]),
    });

    const response = await mangaDetailAction({
      params: { id: "438696" },
      request,
      context: {},
    } as any);

    assert.equal(response.status, 200);
    assert.deepEqual(capturedInput, {
      albumId: "438696",
      chapterIds: ["c2", "c4"],
      selectedChapters: [
        { chapterId: "c2", chapterTitle: "第 2 话", chapterSort: "2" },
        { chapterId: "c4", chapterTitle: "番外", chapterSort: "4" },
      ],
    });
    assert.deepEqual(await response.json(), {
      intent: "download_selected",
      ok: true,
      message: "下载任务已创建，可在下载页查看进度。",
      createdTaskId: "task-1",
    });
  } finally {
    mangaDetailActionDependencies.createAlbumExportTask = originalCreateAlbumExportTask;
  }
});
