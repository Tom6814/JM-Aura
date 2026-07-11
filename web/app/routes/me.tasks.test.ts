import assert from "node:assert/strict";
import test from "node:test";

import {
  action,
  getCompletedDeleteTaskId,
  getMeTasksRefreshState,
  loader,
  meTasksActionDependencies,
  meTasksLoaderDependencies,
} from "./me.tasks";

test("me.tasks loader resolves tasks eagerly", async () => {
  const originalFetchTaskList = meTasksLoaderDependencies.fetchTaskList;
  const originalGetApiOrigin = meTasksLoaderDependencies.getApiOrigin;

  meTasksLoaderDependencies.fetchTaskList = async () => [
    {
      id: "task-1",
      type: "export_album_zip",
      status: "queued",
      createdAt: 1,
      progress: { total: null, current: 0, currentLabel: null },
    },
  ];
  meTasksLoaderDependencies.getApiOrigin = () => "http://127.0.0.1:8787";

  try {
    const response = await loader({
      request: new Request("http://localhost/me/tasks?page=2"),
      params: {},
      context: {},
    } as any);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      apiOrigin: "http://127.0.0.1:8787",
      page: 2,
      pageSize: 20,
      tasks: [
        {
          id: "task-1",
          type: "export_album_zip",
          status: "queued",
          createdAt: 1,
          progress: { total: null, current: 0, currentLabel: null },
        },
      ],
    });
  } finally {
    meTasksLoaderDependencies.fetchTaskList = originalFetchTaskList;
    meTasksLoaderDependencies.getApiOrigin = originalGetApiOrigin;
  }
});

test("me.tasks loader still exposes apiOrigin and task metadata eagerly", async () => {
  const originalFetchTaskList = meTasksLoaderDependencies.fetchTaskList;
  const originalGetApiOrigin = meTasksLoaderDependencies.getApiOrigin;

  meTasksLoaderDependencies.fetchTaskList = async () => [
    {
      id: "task-1",
      type: "export_album_zip",
      status: "queued",
      createdAt: 10,
      metadata: {
        targetType: "album",
        albumId: "a1",
        albumTitle: "夜色本子",
        chapterCount: 2,
      },
      progress: { total: null, current: 0, currentLabel: null },
    },
  ];
  meTasksLoaderDependencies.getApiOrigin = () => "http://127.0.0.1:8787";

  try {
    const response = await loader({
      request: new Request("http://localhost:3000/me/tasks?page=1"),
      params: {},
      context: {},
    } as any);

    assert.deepEqual(await response.json(), {
      apiOrigin: "http://127.0.0.1:8787",
      page: 1,
      pageSize: 20,
      tasks: [
        {
          id: "task-1",
          type: "export_album_zip",
          status: "queued",
          createdAt: 10,
          metadata: {
            targetType: "album",
            albumId: "a1",
            albumTitle: "夜色本子",
            chapterCount: 2,
          },
          progress: { total: null, current: 0, currentLabel: null },
        },
      ],
    });
  } finally {
    meTasksLoaderDependencies.fetchTaskList = originalFetchTaskList;
    meTasksLoaderDependencies.getApiOrigin = originalGetApiOrigin;
  }
});

test("getMeTasksRefreshState only marks the page as refreshing when active tasks are present", () => {
  assert.deepEqual(
    getMeTasksRefreshState({
      visibilityState: "visible",
      revalidatorState: "loading",
      tasks: [
        {
          id: "done-1",
          type: "export_album_zip",
          status: "succeeded",
          createdAt: 1,
          finishedAt: 2,
          progress: { total: 1, current: 1, currentLabel: null },
          result: {
            filePath: "/tmp/a.zip",
            fileName: "a.zip",
            size: 100,
          },
        },
      ],
    }),
    {
      shouldRefresh: false,
      refreshing: false,
    },
  );

  assert.deepEqual(
    getMeTasksRefreshState({
      visibilityState: "visible",
      revalidatorState: "loading",
      tasks: [
        {
          id: "running-1",
          type: "export_album_zip",
          status: "running",
          createdAt: 1,
          progress: { total: 4, current: 2, currentLabel: "第 2 话" },
        },
      ],
    }),
    {
      shouldRefresh: false,
      refreshing: true,
    },
  );

  assert.deepEqual(
    getMeTasksRefreshState({
      visibilityState: "visible",
      revalidatorState: "idle",
      tasks: [
        {
          id: "running-1",
          type: "export_album_zip",
          status: "running",
          createdAt: 1,
          progress: { total: 4, current: 2, currentLabel: "第 2 话" },
        },
      ],
    }),
    {
      shouldRefresh: true,
      refreshing: false,
    },
  );
});

test("me.tasks action deletes task via RPC", async () => {
  const originalDeleteTask = meTasksActionDependencies.deleteTask;
  const deletedTaskIds: string[] = [];

  meTasksActionDependencies.deleteTask = async (_request, id) => {
    deletedTaskIds.push(id);
    return {
      ok: true,
      deletedTaskId: id,
    };
  };

  try {
    const formData = new FormData();
    formData.set("intent", "delete_task");
    formData.set("taskId", "task-2");

    const response = await action({
      request: new Request("http://localhost/me/tasks?page=2", {
        method: "POST",
        body: formData,
      }),
      params: {},
      context: {},
    } as any);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      intent: "delete_task",
      ok: true,
      deletedTaskId: "task-2",
    });
    assert.deepEqual(deletedTaskIds, ["task-2"]);
  } finally {
    meTasksActionDependencies.deleteTask = originalDeleteTask;
  }
});

test("getCompletedDeleteTaskId only returns a task id after a successful settled delete", () => {
  assert.equal(
    getCompletedDeleteTaskId({
      fetcherState: "submitting",
      data: {
        intent: "delete_task",
        ok: true,
        deletedTaskId: "task-2",
      },
    }),
    null,
  );

  assert.equal(
    getCompletedDeleteTaskId({
      fetcherState: "idle",
      data: {
        intent: "delete_task",
        ok: false,
        message: "删除失败",
      },
    }),
    null,
  );

  assert.equal(
    getCompletedDeleteTaskId({
      fetcherState: "idle",
      data: {
        intent: "delete_task",
        ok: true,
        deletedTaskId: "task-2",
      },
    }),
    "task-2",
  );

  assert.deepEqual(
    getMeTasksRefreshState({
      visibilityState: "visible",
      revalidatorState: "idle",
      tasks: [],
    }),
    {
      shouldRefresh: false,
      refreshing: false,
    },
  );
});
