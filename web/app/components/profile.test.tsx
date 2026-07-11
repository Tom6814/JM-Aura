import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import type { ReactNode } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import type { FavoritesResult } from "../../../packages/shared/src/schema";
import {
  ProfileWorkspace,
  buildProfileRetryPath,
  isProfileAuthRequiredError,
  requestButtonFormSubmit,
} from "./profile";

const connectedFavoritesState = {
  favorites: {
    total: 2,
    page_size: 20,
    page_count: 1,
    folder_list: [],
    list: [],
  } as FavoritesResult,
  isLoggedIn: true,
  authMessage: "当前会话已同步收藏。",
  error: null,
};

const emptyProfileState = {
  isLoggedIn: true,
  authMessage: "资料已连接。",
  error: null,
  profile: null,
};

const disconnectedFavoritesState = {
  favorites: null,
  isLoggedIn: false,
  authMessage: "登录后可同步收藏夹并发起收藏夹下载。",
  error: null,
};

test("ProfileWorkspace overview keeps favorites and tasks as entry buttons instead of inline sections", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      loginSyncState={null}
      pendingIntent={null}
      favoritesState={connectedFavoritesState}
      profileState={emptyProfileState}
      tasksState={{
        tasks: [],
        error: null,
      }}
    />,
  );

  assert.match(markup, /profile-overview-card/);
  assert.match(markup, /收藏夹/);
  assert.match(markup, /下载/);
  assert.doesNotMatch(markup, /下载列表、入口与过期提示/);
  assert.doesNotMatch(markup, /登录后查看收藏夹/);
});

test("ProfileWorkspace favorites tab renders the standalone favorites page", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="favorites"
      albumId={null}
      createdTaskId={null}
      loginSyncState={null}
      pendingIntent={null}
      favoritesState={connectedFavoritesState}
      profileState={emptyProfileState}
      tasksState={{
        tasks: [],
        error: null,
      }}
    />,
  );

  assert.match(markup, /已收藏 2 部作品/);
  assert.match(markup, /profile-overview-card/);
  assert.match(markup, /profile-workspace__pages/);
});

test("ProfileWorkspace overview shows nickname, level, title, signature and avatar when profile data exists", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      loginSyncState={null}
      pendingIntent={null}
      favoritesState={connectedFavoritesState}
      profileState={{
        isLoggedIn: true,
        authMessage: "资料已连接。",
        error: null,
        profile: {
          username: "jm_user",
          nickname: "小鲸鱼",
          avatar: "https://cdn.example/avatar.jpg",
          level: "LV.12",
          title: "至尊会员",
          badge: null,
          signature: "漫读者",
        },
      }}
      tasksState={{
        tasks: [],
        error: null,
      }}
    />,
  );

  assert.match(markup, /小鲸鱼/);
  assert.match(markup, /LV\.12/);
  assert.match(markup, /至尊会员/);
  assert.match(markup, /漫读者/);
  assert.match(markup, /avatar\.jpg/);
});

test("ProfileWorkspace keeps favorites and tasks visible when profile fails", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      loginSyncState={null}
      pendingIntent={null}
      favoritesState={{
        favorites: {
          total: 3,
          page_size: 20,
          page_count: 1,
          folder_list: [],
          list: [],
        } as FavoritesResult,
        isLoggedIn: true,
        authMessage: "收藏夹已连接。",
        error: null,
      }}
      profileState={{
        isLoggedIn: false,
        authMessage: "资料区未同步。",
        error: "资料同步失败，请稍后重试。",
        profile: null,
      }}
      tasksState={{
        tasks: [],
        error: null,
      }}
    />,
  );

  assert.match(markup, /资料同步失败，请稍后重试。/);
  assert.match(markup, /收藏夹/);
  assert.match(markup, /下载/);
});

test("ProfileWorkspace keeps overview entry buttons visible when auth fallback is needed", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      loginSyncState={null}
      pendingIntent={null}
      favoritesState={{
        favorites: {
          total: 3,
          page_size: 20,
          page_count: 1,
          folder_list: [],
          list: [],
        } as FavoritesResult,
        isLoggedIn: true,
        authMessage: "收藏夹已连接。",
        error: "禁漫API请求失败，code=401，msg=請先登入會員",
      }}
      profileState={emptyProfileState}
      tasksState={{
        tasks: [],
        error: null,
      }}
    />,
  );

  assert.match(markup, /即将切换到登录界面/);
  assert.match(markup, /收藏夹/);
  assert.match(markup, /下载/);
});

test("ProfileWorkspace falls back to login when profile error reports Not legal.user", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      loginSyncState={null}
      pendingIntent={null}
      favoritesState={connectedFavoritesState}
      profileState={{
        isLoggedIn: false,
        authMessage: "资料区未同步。",
        error: 'data返回值异常: {"code":200,"data":[],"errorMsg":"Not legal.user"}',
        profile: null,
      }}
      tasksState={{
        tasks: [],
        error: null,
      }}
    />,
  );

  assert.match(markup, /即将切换到登录界面/);
  assert.match(markup, /登录并同步/);
  assert.doesNotMatch(markup, /工作区刷新失败/);
});

test("isProfileAuthRequiredError detects auth-expired workspace errors", () => {
  assert.equal(isProfileAuthRequiredError("禁漫API请求失败，code=401，msg=請先登入會員"), true);
  assert.equal(
    isProfileAuthRequiredError('data返回值异常: {"code":200,"data":[],"errorMsg":"Not legal.user"}'),
    true,
  );
  assert.equal(isProfileAuthRequiredError("登录状态同步失败，请稍后重试。"), false);
});

test("buildProfileRetryPath targets the me index route so login sync can refresh without full reload", () => {
  assert.equal(
    buildProfileRetryPath("favorites", 123),
    "/me?index&profile-retry=favorites&nonce=123",
  );
  assert.equal(
    buildProfileRetryPath("profile", 456),
    "/me?index&profile-retry=profile&nonce=456",
  );
});

test("ProfileWorkspace keeps login button in loading state while delayed sync is waiting", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      loginSyncState={{
        phase: "waiting",
        message: "登录成功，正在同步资料...",
      }}
      pendingIntent={null}
      favoritesState={disconnectedFavoritesState}
      profileState={{
        isLoggedIn: false,
        authMessage: "登录后可同步头像、等级、称号与签名。",
        error: null,
        profile: null,
      }}
      tasksState={{
        tasks: [],
        error: null,
      }}
    />,
  );

  assert.match(markup, /登录中\.\.\./);
  assert.match(markup, /progress_activity/);
});

test("ProfileWorkspace does not show login pending state before user submits the form", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      loginSyncState={null}
      pendingIntent={null}
      favoritesState={disconnectedFavoritesState}
      profileState={{
        isLoggedIn: false,
        authMessage: "登录后可同步头像、等级、称号与签名。",
        error: null,
        profile: null,
      }}
      tasksState={{
        tasks: [],
        error: null,
      }}
    />,
  );

  assert.match(markup, /登录并同步/);
  assert.doesNotMatch(markup, /登录中\.\.\./);
});

test("ProfileWorkspace login form posts to the me index action", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      loginSyncState={null}
      pendingIntent={null}
      favoritesState={disconnectedFavoritesState}
      profileState={{
        isLoggedIn: false,
        authMessage: "登录后可同步头像、等级、称号与签名。",
        error: null,
        profile: null,
      }}
      tasksState={{
        tasks: [],
        error: null,
      }}
    />,
  );

  assert.match(markup, /action=\"\/me\?index\"/);
});

test("requestButtonFormSubmit forces the parent form to submit exactly once", () => {
  let prevented = false;
  let submitCalled = false;
  const button = {
    form: {
      reportValidity() {
        return true;
      },
      submit() {
        submitCalled = true;
      },
    },
  };

  requestButtonFormSubmit({
    preventDefault() {
      prevented = true;
    },
    currentTarget: button as never,
  });

  assert.equal(prevented, true);
  assert.equal(submitCalled, true);
});

async function renderWithRouter(element: ReactNode) {
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
}
