import test from "node:test";
import assert from "node:assert/strict";

import {
  formatTaskStatusLabel,
  formatTaskSummary,
  formatTaskTagList,
  getTaskDownloadState,
  mapTaskStatusTone,
} from "./tasks.server";

test("mapTaskStatusTone maps task states to stable UI tones", () => {
  assert.equal(mapTaskStatusTone("queued"), "neutral");
  assert.equal(mapTaskStatusTone("running"), "accent");
  assert.equal(mapTaskStatusTone("succeeded"), "success");
  assert.equal(mapTaskStatusTone("failed"), "error");
});

test("formatTaskStatusLabel keeps reader-facing task copy stable", () => {
  assert.equal(formatTaskStatusLabel("queued"), "等待中");
  assert.equal(formatTaskStatusLabel("running"), "进行中");
  assert.equal(formatTaskStatusLabel("succeeded"), "已完成");
  assert.equal(formatTaskStatusLabel("failed"), "失败");
  assert.equal(formatTaskStatusLabel("canceled"), "已取消");
});

test("formatTaskSummary prefers progress details for running tasks", () => {
  assert.equal(
    formatTaskSummary({
      type: "export_album_zip",
      status: "running",
      createdAt: 1,
      progress: {
        total: 12,
        current: 3,
        currentLabel: "第 3 话",
      },
    }),
    "作品下载 · 已处理 3 / 12 · 第 3 话",
  );
});

test("formatTaskSummary surfaces result and error details", () => {
  assert.equal(
    formatTaskSummary({
      type: "export_favorites_zip",
      status: "succeeded",
      createdAt: 1,
      progress: {
        total: 20,
        current: 20,
        currentLabel: null,
      },
      result: {
        filePath: "/tmp/favorites.zip",
        fileName: "favorites-0.zip",
        size: 1234,
      },
    }),
    "收藏夹下载 · 已生成 favorites-0.zip",
  );

  assert.equal(
    formatTaskSummary({
      type: "export_album_zip",
      status: "failed",
      createdAt: 1,
      progress: {
        total: null,
        current: 0,
        currentLabel: null,
      },
      error: {
        message: "网络超时",
      },
    }),
    "作品下载 · 网络超时",
  );
});

test("formatTaskSummary trims succeeded export file name for compact task copy", () => {
  assert.equal(
    formatTaskSummary({
      type: "export_album_zip",
      status: "succeeded",
      createdAt: 1,
      progress: {
        total: 1,
        current: 1,
        currentLabel: null,
      },
      result: {
        filePath: "/tmp/album.zip",
        fileName: " album.zip ",
        size: 1234,
      },
    }),
    "作品下载 · 已生成 album.zip",
  );
});

test("formatTaskTagList keeps task type status and download tags stable", () => {
  assert.deepEqual(
    formatTaskTagList({
      id: "task-1",
      type: "export_favorites_zip",
      status: "succeeded",
      createdAt: 1,
      progress: {
        total: 20,
        current: 20,
        currentLabel: null,
      },
      result: {
        filePath: "/tmp/favorites.zip",
        fileName: "favorites-0.zip",
        size: 1234,
      },
    }),
    ["收藏夹下载", "已完成", "可下载"],
  );

  assert.deepEqual(
    formatTaskTagList({
      id: "task-2",
      type: "export_album_zip",
      status: "failed",
      createdAt: 1,
      progress: {
        total: 12,
        current: 2,
        currentLabel: null,
      },
      error: {
        message: "网络超时",
      },
    }),
    ["作品下载", "失败", "需重试"],
  );
});

test("getTaskDownloadState exposes ready and pending download affordances", () => {
  assert.deepEqual(
    getTaskDownloadState(
      {
        id: "task-1",
        type: "export_favorites_zip",
        status: "succeeded",
        createdAt: 1,
        progress: {
          total: 20,
          current: 20,
          currentLabel: null,
        },
        result: {
          filePath: "/tmp/favorites.zip",
          fileName: "favorites-0.zip",
          size: 1234,
        },
      },
      { apiOrigin: "http://127.0.0.1:8787" },
    ),
    {
      href: "http://127.0.0.1:8787/api/tasks/task-1/download",
      label: "下载 ZIP",
      hint: "下载文件通常保留 2 小时，过期后请重新发起下载。",
      isReady: true,
    },
  );

  assert.deepEqual(
    getTaskDownloadState({
      id: "task-2",
      type: "export_album_zip",
      status: "running",
      createdAt: 1,
      progress: {
        total: 12,
        current: 3,
        currentLabel: "第 3 话",
      },
    }),
    {
      href: null,
      label: "处理中",
      hint: "下载完成后即可在这里保存文件，过期后需要重新发起下载。",
      isReady: false,
    },
  );
});
