import assert from "node:assert/strict";
import test from "node:test";

import { loader, meFavoritesLoaderDependencies } from "./me.favorites";

test("me.favorites loader resolves favorites eagerly when logged in", async () => {
  const originalGetFavoritesPageSize = meFavoritesLoaderDependencies.getFavoritesPageSize;
  const originalGetApiOrigin = meFavoritesLoaderDependencies.getApiOrigin;
  const originalHasRequestCookie = meFavoritesLoaderDependencies.hasRequestCookie;
  const originalFetchFavorites = meFavoritesLoaderDependencies.fetchFavorites;

  meFavoritesLoaderDependencies.getFavoritesPageSize = async () => 20;
  meFavoritesLoaderDependencies.getApiOrigin = () => "http://localhost:8787";
  meFavoritesLoaderDependencies.hasRequestCookie = () => true;
  meFavoritesLoaderDependencies.fetchFavorites = async () => ({
    list: [],
    folder_list: [{ FID: "0", name: "全部收藏" }],
    total: 0,
    page_size: 20,
    page_count: 1,
  });

  try {
    const response = await loader({
      request: new Request("http://localhost/me/favorites?folder=0&page=3"),
      params: {},
      context: {},
    } as any);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      apiOrigin: "http://localhost:8787",
      isLoggedIn: true,
      folderId: "0",
      page: 3,
      pageSize: 20,
      favorites: {
        list: [],
        folder_list: [{ FID: "0", name: "全部收藏" }],
        total: 0,
        page_size: 20,
        page_count: 1,
      },
    });
  } finally {
    meFavoritesLoaderDependencies.getFavoritesPageSize = originalGetFavoritesPageSize;
    meFavoritesLoaderDependencies.getApiOrigin = originalGetApiOrigin;
    meFavoritesLoaderDependencies.hasRequestCookie = originalHasRequestCookie;
    meFavoritesLoaderDependencies.fetchFavorites = originalFetchFavorites;
  }
});
