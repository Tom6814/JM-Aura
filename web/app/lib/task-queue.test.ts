import assert from "node:assert/strict";
import test from "node:test";

import type { TaskSummary } from "./jm-rpc.server";
import { formatTaskDisplayTarget, getTaskDownloadState } from "./tasks";
import {
  buildTaskQueueOverview,
  findAutoDownloadTaskId,
  getTaskProgressSnapshot,
  partitionTaskQueue,
  sortTaskQueueItems,
  shouldAutoRefreshTaskQueue,
} from "./task-queue";

const queuedTask: TaskSummary = {
  id: "queued-1",
  type: "export_album_zip",
  status: "queued",
  createdAt: 20,
  progress: { total: null, current: 0, currentLabel: null },
};

const runningTask: TaskSummary = {
  id: "running-1",
  type: "export_album_zip",
  status: "running",
  createdAt: 10,
  progress: { total: 12, current: 3, currentLabel: "第 3 话" },
};

const doneTask: TaskSummary = {
  id: "done-1",
  type: "export_album_zip",
  status: "succeeded",
  createdAt: 30,
  finishedAt: 40,
  progress: { total: 12, current: 12, currentLabel: null },
  result: {
    filePath: "/tmp/a.zip",
    fileName: "a.zip",
    size: 1234,
  },
};

test("sortTaskQueueItems keeps running and queued tasks ahead of completed ones", () => {
  const sorted = sortTaskQueueItems([doneTask, queuedTask, runningTask]);
  assert.deepEqual(
    sorted.map((task) => task.id),
    ["running-1", "queued-1", "done-1"],
  );
});

test("formatTaskDisplayTarget uses album title and chapter count from metadata", () => {
  assert.deepEqual(
    formatTaskDisplayTarget({
      type: "export_album_zip",
      metadata: {
        targetType: "album",
        albumId: "a1",
        albumTitle: "夜色本子",
        chapterCount: 3,
        selectedChapters: [
          { chapterId: "c2", chapterTitle: "第 2 话", chapterSort: "2" },
          { chapterId: "c4", chapterTitle: "番外", chapterSort: "4" },
        ],
      },
    }),
    {
      title: "夜色本子",
      subtitle: "JM a1 · 共 3 话",
      details: "章节：第 2 话（c2）、番外（c4）",
    },
  );
});

test("getTaskDownloadState uses generic ZIP label", () => {
  assert.equal(
    getTaskDownloadState(
      {
        id: "task-1",
        type: "export_album_zip",
        status: "succeeded",
        createdAt: 1,
        progress: { total: 3, current: 3, currentLabel: null },
        result: {
          filePath: "/tmp/a.zip",
          fileName: "a.zip",
          size: 1024,
        },
      },
      { apiOrigin: "http://127.0.0.1:8787" },
    ).label,
    "下载 ZIP",
  );
});

test("partitionTaskQueue splits active and history tasks and keeps history sorted by completion time", () => {
  const failedTask: TaskSummary = {
    id: "failed-1",
    type: "export_album_zip",
    status: "failed",
    createdAt: 15,
    finishedAt: 45,
    progress: { total: 12, current: 4, currentLabel: null },
    error: { message: "网络超时" },
  };
  const canceledTask: TaskSummary = {
    id: "canceled-1",
    type: "export_album_zip",
    status: "canceled",
    createdAt: 12,
    finishedAt: 35,
    progress: { total: null, current: 0, currentLabel: null },
  };

  const { activeTasks, historyTasks } = partitionTaskQueue([
    doneTask,
    failedTask,
    queuedTask,
    canceledTask,
    runningTask,
  ]);

  assert.deepEqual(
    activeTasks.map((task) => task.id),
    ["queued-1", "running-1"],
  );
  assert.deepEqual(
    historyTasks.map((task) => task.id),
    ["failed-1", "done-1", "canceled-1"],
  );
});

test("partitionTaskQueue preserves input order when timestamps are tied", () => {
  const firstDone: TaskSummary = {
    id: "done-a",
    type: "export_album_zip",
    status: "succeeded",
    createdAt: 5,
    finishedAt: 20,
    progress: { total: 1, current: 1, currentLabel: null },
    result: {
      filePath: "/tmp/done-a.zip",
      fileName: "done-a.zip",
      size: 10,
    },
  };
  const secondDone: TaskSummary = {
    id: "done-b",
    type: "export_album_zip",
    status: "succeeded",
    createdAt: 5,
    finishedAt: 20,
    progress: { total: 1, current: 1, currentLabel: null },
    result: {
      filePath: "/tmp/done-b.zip",
      fileName: "done-b.zip",
      size: 10,
    },
  };

  const { historyTasks } = partitionTaskQueue([secondDone, firstDone]);
  assert.deepEqual(
    historyTasks.map((task) => task.id),
    ["done-b", "done-a"],
  );
});

test("partitionTaskQueue keeps history tasks out of active section", () => {
  const tasks: TaskSummary[] = [
    {
      id: "done-history",
      type: "export_album_zip",
      status: "succeeded",
      createdAt: 1,
      finishedAt: 2,
      progress: { total: 1, current: 1, currentLabel: null },
      metadata: {
        targetType: "album",
        albumId: "a1",
        albumTitle: "夜色本子",
        chapterCount: 1,
      },
      result: {
        filePath: "/tmp/a.zip",
        fileName: "a.zip",
        size: 100,
      },
    },
  ];

  const { activeTasks, historyTasks } = partitionTaskQueue(tasks);

  assert.equal(activeTasks.length, 0);
  assert.equal(historyTasks.length, 1);
  assert.equal(historyTasks[0]?.id, "done-history");
});

test("getTaskProgressSnapshot returns determinate ratio for counted progress", () => {
  assert.deepEqual(getTaskProgressSnapshot(runningTask), {
    current: 3,
    total: 12,
    percent: 25,
    determinate: true,
    label: "已处理 3 / 12",
  });
});

test("getTaskProgressSnapshot falls back to indeterminate progress for active tasks without total", () => {
  assert.deepEqual(getTaskProgressSnapshot(queuedTask), {
    current: 0,
    total: null,
    percent: null,
    determinate: false,
    label: "等待处理中",
  });
});

test("buildTaskQueueOverview summarizes active and completed tasks", () => {
  const failedTask: TaskSummary = {
    id: "failed-2",
    type: "export_album_zip",
    status: "failed",
    createdAt: 25,
    finishedAt: 50,
    progress: { total: 12, current: 4, currentLabel: null },
    error: { message: "网络超时" },
  };

  assert.deepEqual(buildTaskQueueOverview([queuedTask, runningTask, doneTask, failedTask]), {
    total: 4,
    active: 2,
    completed: 1,
    failed: 1,
  });
});

test("shouldAutoRefreshTaskQueue only enables polling for visible pages with active tasks", () => {
  assert.equal(
    shouldAutoRefreshTaskQueue({
      visibilityState: "visible",
      revalidatorState: "idle",
      tasks: [runningTask],
    }),
    true,
  );

  assert.equal(
    shouldAutoRefreshTaskQueue({
      visibilityState: "hidden",
      revalidatorState: "idle",
      tasks: [runningTask],
    }),
    false,
  );

  assert.equal(
    shouldAutoRefreshTaskQueue({
      visibilityState: "visible",
      revalidatorState: "loading",
      tasks: [runningTask],
    }),
    false,
  );

  assert.equal(
    shouldAutoRefreshTaskQueue({
      visibilityState: "visible",
      revalidatorState: "idle",
      tasks: [doneTask],
    }),
    false,
  );
});

test("findAutoDownloadTaskId only picks tasks that newly transition to succeeded", () => {
  const completedRunningTask: TaskSummary = {
    ...runningTask,
    status: "succeeded",
    result: {
      filePath: "/tmp/running-1.zip",
      fileName: "running-1.zip",
      size: 2048,
    },
  };

  assert.equal(
    findAutoDownloadTaskId({
      previousTasks: [runningTask],
      nextTasks: [completedRunningTask],
      handledTaskIds: new Set(),
    }),
    "running-1",
  );

  assert.equal(
    findAutoDownloadTaskId({
      previousTasks: [completedRunningTask],
      nextTasks: [completedRunningTask],
      handledTaskIds: new Set(),
    }),
    null,
  );

  assert.equal(
    findAutoDownloadTaskId({
      previousTasks: [runningTask],
      nextTasks: [completedRunningTask],
      handledTaskIds: new Set(["running-1"]),
    }),
    null,
  );

  assert.equal(
    findAutoDownloadTaskId({
      previousTasks: [],
      nextTasks: [doneTask],
      handledTaskIds: new Set(),
    }),
    null,
  );
});
