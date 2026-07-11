import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import type { TaskSummary } from "../lib/jm-rpc.server";
import { TaskQueuePanel } from "./task-queue";

const runningTask: TaskSummary = {
  id: "task-1",
  type: "export_album_zip",
  status: "running",
  createdAt: 1,
  progress: {
    total: 12,
    current: 3,
    currentLabel: "第 3 话",
  },
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
};

const doneTask: TaskSummary = {
  id: "task-2",
  type: "export_album_zip",
  status: "succeeded",
  createdAt: 2,
  finishedAt: 4,
  progress: {
    total: 12,
    current: 12,
    currentLabel: null,
  },
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
  result: {
    filePath: "/tmp/a.zip",
    fileName: "a.zip",
    size: 2048,
  },
};

const failedTask: TaskSummary = {
  id: "task-3",
  type: "export_album_zip",
  status: "failed",
  createdAt: 3,
  finishedAt: 5,
  progress: {
    total: 12,
    current: 4,
    currentLabel: null,
  },
  metadata: {
    targetType: "album",
    albumId: "a2",
    albumTitle: "雾海夜航",
    chapterCount: 5,
  },
  error: {
    message: "网络超时",
  },
};

test("TaskQueuePanel renders overview, active section, and completed-or-failed history with ZIP button label", () => {
  const router = createMemoryRouter([
    {
      path: "/me/tasks",
      element: (
        <TaskQueuePanel
          apiOrigin="http://127.0.0.1:8787"
          tasks={[runningTask, doneTask, failedTask]}
          page={1}
          pageCount={1}
          pageSize={20}
        />
      ),
    },
  ], {
    initialEntries: ["/me/tasks"],
  });

  const markup = renderToStaticMarkup(<RouterProvider router={router} />);

  assert.match(markup, /任务总数/);
  assert.match(markup, /进行中/);
  assert.match(markup, /已完成与失败/);
  assert.match(markup, /class="task-queue__progress-bar"/);
  assert.match(markup, /已处理 3 \/ 12/);
  assert.match(markup, /夜色本子/);
  assert.match(markup, /JM a1/);
  assert.match(markup, /共 3 话/);
  assert.match(markup, /章节：第 2 话（c2）、番外（c4）/);
  assert.match(markup, /下载 ZIP/);
  assert.match(markup, /删除任务/);
  assert.doesNotMatch(markup, /下载 a\.zip/);
});

test("TaskQueuePanel marks the matching history task as deleting", () => {
  const router = createMemoryRouter([
    {
      path: "/me/tasks",
      element: (
        <TaskQueuePanel
          apiOrigin="http://127.0.0.1:8787"
          tasks={[doneTask]}
          page={1}
          pageCount={1}
          pageSize={20}
          deletingTaskId="task-2"
          onDeleteTask={() => {}}
        />
      ),
    },
  ], {
    initialEntries: ["/me/tasks"],
  });

  const markup = renderToStaticMarkup(<RouterProvider router={router} />);

  assert.match(markup, /删除中\.\.\./);
});
