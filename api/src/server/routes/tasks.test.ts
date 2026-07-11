import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTasksRouter } from "./tasks";
import { TaskManager } from "../task/taskManager";
import { ExportStore } from "../export/exportStore";
import { JmSessionManager } from "../session";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);

type SessionHeadersInput = {
  headerSessionId?: string;
  cookieSessionId?: string;
  contentType?: string;
};

type TasksAppFixture = {
  app: Hono;
  exportStore: ExportStore;
  taskManager: TaskManager;
  sessionManager: JmSessionManager;
  cleanup(): Promise<void>;
};

function buildHeaders(input: SessionHeadersInput = {}): HeadersInit {
  const headers = new Headers();
  if (input.contentType) headers.set("content-type", input.contentType);
  if (input.headerSessionId) headers.set("x-jm-session", input.headerSessionId);
  if (input.cookieSessionId) headers.set("cookie", `aura_session=${input.cookieSessionId}`);
  return headers;
}

async function createTasksAppFixture(options: {
  ttlMs?: number;
  cleanupIntervalMs?: number;
  createSessionManager?: (deps: { taskManager: TaskManager; exportStore: ExportStore }) => JmSessionManager;
  exportAlbumToZip?: Parameters<typeof createTasksRouter>[0]["exportAlbumToZip"];
  exportFavoritesToZip?: Parameters<typeof createTasksRouter>[0]["exportFavoritesToZip"];
} = {}): Promise<TasksAppFixture> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jm-aura-exports-"));
  const exportStore = new ExportStore({
    rootDir: tmpRoot,
    ttlMs: options.ttlMs ?? 60_000,
    cleanupIntervalMs: options.cleanupIntervalMs ?? 60_000,
  });
  const taskManager = new TaskManager({ concurrency: 1 });
  const sessionManager =
    options.createSessionManager?.({ taskManager, exportStore }) ??
    new JmSessionManager({
      createClient: () => ({ marker: "client" } as any),
    });

  const app = new Hono();
  app.route(
    "",
    createTasksRouter({
      taskManager,
      exportStore,
      sessionManager,
      exportAlbumToZip:
        options.exportAlbumToZip ??
        (async ({ zipPath }) => {
          await fs.writeFile(zipPath, ZIP_BYTES);
        }),
      exportFavoritesToZip:
        options.exportFavoritesToZip ??
        (async ({ zipPath }) => {
          await fs.writeFile(zipPath, ZIP_BYTES);
        }),
    }),
  );

  return {
    app,
    exportStore,
    taskManager,
    sessionManager,
    async cleanup() {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    },
  };
}

async function createAlbumTask(
  app: Hono,
  input: {
    albumId: string;
    headerSessionId?: string;
    cookieSessionId?: string;
    chapterIds?: string[];
    selectedChapters?: Array<{ chapterId: string; chapterTitle?: string | null; chapterSort?: string | null }>;
    imageFormat?: "original" | "webp" | "jpeg";
  },
) {
  const response = await app.request(
    new Request("http://localhost/api/tasks/export/album", {
      method: "POST",
      headers: buildHeaders({
        headerSessionId: input.headerSessionId,
        cookieSessionId: input.cookieSessionId,
        contentType: "application/json",
      }),
      body: JSON.stringify({
        albumId: input.albumId,
        chapterIds: input.chapterIds,
        selectedChapters: input.selectedChapters,
        imageFormat: input.imageFormat ?? "webp",
      }),
    }),
  );
  assert.equal(response.status, 201);
  return (await response.json()) as any;
}

async function waitForTask(
  app: Hono,
  taskId: string,
  session: { headerSessionId?: string; cookieSessionId?: string },
): Promise<any> {
  for (let i = 0; i < 50; i += 1) {
    const response = await app.request(
      new Request(`http://localhost/api/tasks/${taskId}`, {
        headers: buildHeaders(session),
      }),
    );
    assert.equal(response.status, 200);
    const task = await response.json();
    if (task.status === "succeeded") return task;
    await sleep(10);
  }

  throw new Error(`task ${taskId} should succeed within time`);
}

test("tasks route: create -> get -> download (export album zip)", async () => {
  let receivedClient: unknown = null;
  const fixture = await createTasksAppFixture({
    exportAlbumToZip: async ({ zipPath, jmClient }) => {
      receivedClient = jmClient;
      await fs.writeFile(zipPath, ZIP_BYTES);
    },
  });

  try {
    const created = await createAlbumTask(fixture.app, {
      albumId: "123456",
      headerSessionId: "s1",
    });
    assert.ok(created.id);

    const finalTask = await waitForTask(fixture.app, created.id, { headerSessionId: "s1" });
    assert.equal(finalTask.type, "export_album_zip");
    assert.ok(finalTask.result?.filePath);
    assert.ok(String(finalTask.result?.fileName ?? "").endsWith(".zip"));
    assert.equal(receivedClient !== null, true);

    const downloadResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}/download`, {
        headers: buildHeaders({ headerSessionId: "s1" }),
      }),
    );
    assert.equal(downloadResp.status, 200);
    assert.equal(downloadResp.headers.get("content-type"), "application/zip");
    const cd = downloadResp.headers.get("content-disposition") ?? "";
    assert.ok(cd.includes("attachment"));
    assert.ok(cd.includes(".zip"));
    assert.ok(cd.includes("filename="));
    assert.ok(cd.includes("filename*="));
    assert.equal(downloadResp.headers.get("cache-control"), "private, no-store, no-cache, max-age=0, must-revalidate");

    const downloaded = Buffer.from(await downloadResp.arrayBuffer());
    assert.deepEqual(downloaded, ZIP_BYTES);
  } finally {
    await fixture.cleanup();
  }
});

test("tasks route: export album forwards selected chapterIds", async () => {
  let receivedChapterIds: string[] | undefined;
  const fixture = await createTasksAppFixture({
    exportAlbumToZip: async ({ zipPath, chapterIds }) => {
      receivedChapterIds = chapterIds;
      await fs.writeFile(zipPath, ZIP_BYTES);
    },
  });

  try {
    await createAlbumTask(fixture.app, {
      albumId: "123456",
      headerSessionId: "s1",
      chapterIds: ["c2", "c4"],
    });

    for (let i = 0; i < 50; i += 1) {
      const tasks = await fixture.app.request(
        new Request("http://localhost/api/tasks", {
          headers: buildHeaders({ headerSessionId: "s1" }),
        }),
      );
      const list = await tasks.json();
      if (Array.isArray(list) && list[0]?.status === "succeeded") break;
      await sleep(10);
    }

    assert.deepEqual(receivedChapterIds, ["c2", "c4"]);
  } finally {
    await fixture.cleanup();
  }
});

test("tasks route: export album returns metadata with album title and chapter count", async () => {
  const fixture = await createTasksAppFixture({
    createSessionManager: () =>
      new JmSessionManager({
        createClient: () =>
          ({
            marker: "client",
            fetchAlbumDetail: async () => ({
              data: {
                name: "示例本子",
              },
            }),
          }) as any,
      }),
    exportAlbumToZip: async ({ zipPath }) => {
      await fs.writeFile(zipPath, ZIP_BYTES);
    },
  });

  try {
    const created = await createAlbumTask(fixture.app, {
      albumId: "123456",
      headerSessionId: "s1",
      chapterIds: ["c1", "c2", "c3"],
      selectedChapters: [
        { chapterId: "c1", chapterTitle: "第 1 话", chapterSort: "1" },
        { chapterId: "c2", chapterTitle: "第 2 话", chapterSort: "2" },
        { chapterId: "c3", chapterTitle: "第 3 话", chapterSort: "3" },
      ],
      imageFormat: "webp",
    });
    assert.deepEqual(created.metadata, {
      targetType: "album",
      albumId: "123456",
      albumTitle: "示例本子",
      chapterCount: 3,
      selectedChapters: [
        { chapterId: "c1", chapterTitle: "第 1 话", chapterSort: "1" },
        { chapterId: "c2", chapterTitle: "第 2 话", chapterSort: "2" },
        { chapterId: "c3", chapterTitle: "第 3 话", chapterSort: "3" },
      ],
    });

    const getResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}`, {
        headers: buildHeaders({ headerSessionId: "s1" }),
      }),
    );
    assert.equal(getResp.status, 200);
    const fetched = (await getResp.json()) as any;
    assert.deepEqual(fetched.metadata, {
      targetType: "album",
      albumId: "123456",
      albumTitle: "示例本子",
      chapterCount: 3,
      selectedChapters: [
        { chapterId: "c1", chapterTitle: "第 1 话", chapterSort: "1" },
        { chapterId: "c2", chapterTitle: "第 2 话", chapterSort: "2" },
        { chapterId: "c3", chapterTitle: "第 3 话", chapterSort: "3" },
      ],
    });

    for (let i = 0; i < 50; i += 1) {
      const resp = await fixture.app.request(
        new Request(`http://localhost/api/tasks/${created.id}`, {
          headers: buildHeaders({ headerSessionId: "s1" }),
        }),
      );
      const task = await resp.json();
      if (task.status === "succeeded") break;
      await sleep(10);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("tasks route: export favorites returns metadata with folder info", async () => {
  const fixture = await createTasksAppFixture({
    exportFavoritesToZip: async ({ zipPath }) => {
      await fs.writeFile(zipPath, ZIP_BYTES);
    },
  });

  try {
    const createResp = await fixture.app.request(
      new Request("http://localhost/api/tasks/export/favorites", {
        method: "POST",
        headers: buildHeaders({
          headerSessionId: "s1",
          contentType: "application/json",
        }),
        body: JSON.stringify({
          folderId: "42",
          orderBy: "mr",
          imageFormat: "webp",
        }),
      }),
    );

    assert.equal(createResp.status, 201);
    const created = (await createResp.json()) as any;
    assert.deepEqual(created.metadata, {
      targetType: "favorites",
      folderId: "42",
      folderName: "收藏夹 42",
    });

    const getResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}`, {
        headers: buildHeaders({ headerSessionId: "s1" }),
      }),
    );
    assert.equal(getResp.status, 200);
    const fetched = (await getResp.json()) as any;
    assert.deepEqual(fetched.metadata, {
      targetType: "favorites",
      folderId: "42",
      folderName: "收藏夹 42",
    });

    for (let i = 0; i < 50; i += 1) {
      const resp = await fixture.app.request(
        new Request(`http://localhost/api/tasks/${created.id}`, {
          headers: buildHeaders({ headerSessionId: "s1" }),
        }),
      );
      const task = await resp.json();
      if (task.status === "succeeded") break;
      await sleep(10);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("tasks route only lists tasks for current session and keeps newest first", async () => {
  const fixture = await createTasksAppFixture();

  try {
    await createAlbumTask(fixture.app, {
      albumId: "a1",
      cookieSessionId: "session-a",
    });
    await sleep(2);
    await createAlbumTask(fixture.app, {
      albumId: "a2",
      cookieSessionId: "session-a",
    });
    await createAlbumTask(fixture.app, {
      albumId: "b1",
      cookieSessionId: "session-b",
    });

    const listAResp = await fixture.app.request(
      new Request("http://localhost/api/tasks", {
        headers: buildHeaders({ cookieSessionId: "session-a" }),
      }),
    );
    const listBResp = await fixture.app.request(
      new Request("http://localhost/api/tasks", {
        headers: buildHeaders({ cookieSessionId: "session-b" }),
      }),
    );

    assert.equal(listAResp.status, 200);
    assert.equal(listBResp.status, 200);

    const listA = (await listAResp.json()) as Array<{ metadata?: { albumId?: string }; createdAt: number }>;
    const listB = (await listBResp.json()) as Array<{ metadata?: { albumId?: string } }>;

    assert.equal(listA.length, 2);
    assert.deepEqual(
      listA.map((task) => task.metadata?.albumId),
      ["a2", "a1"],
    );
    assert.ok(listA[0]!.createdAt >= listA[1]!.createdAt);
    assert.equal(listB.length, 1);
    assert.deepEqual(
      listB.map((task) => task.metadata?.albumId),
      ["b1"],
    );
  } finally {
    await fixture.cleanup();
  }
});

test("tasks route enforces session ownership for get cancel download and delete", async () => {
  const fixture = await createTasksAppFixture();

  try {
    const created = await createAlbumTask(fixture.app, {
      albumId: "secure-1",
      cookieSessionId: "session-a",
    });
    await waitForTask(fixture.app, created.id, { cookieSessionId: "session-a" });

    const getResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}`, {
        headers: buildHeaders({ cookieSessionId: "session-b" }),
      }),
    );
    assert.equal(getResp.status, 404);
    assert.deepEqual(await getResp.json(), { error: "任务不存在" });

    const cancelResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}/cancel`, {
        method: "POST",
        headers: buildHeaders({ cookieSessionId: "session-b" }),
      }),
    );
    assert.equal(cancelResp.status, 404);
    assert.deepEqual(await cancelResp.json(), { error: "任务不存在" });

    const downloadResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}/download`, {
        headers: buildHeaders({ cookieSessionId: "session-b" }),
      }),
    );
    assert.equal(downloadResp.status, 404);
    assert.deepEqual(await downloadResp.json(), {
      error: "导出文件不存在",
      code: "EXPORT_NOT_FOUND",
    });

    const deleteResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}`, {
        method: "DELETE",
        headers: buildHeaders({ cookieSessionId: "session-b" }),
      }),
    );
    assert.equal(deleteResp.status, 404);
    assert.deepEqual(await deleteResp.json(), { error: "任务不存在" });
  } finally {
    await fixture.cleanup();
  }
});

test("tasks route deletes owned task and its zip file", async () => {
  const fixture = await createTasksAppFixture();

  try {
    const created = await createAlbumTask(fixture.app, {
      albumId: "delete-me",
      cookieSessionId: "session-a",
    });
    const task = await waitForTask(fixture.app, created.id, { cookieSessionId: "session-a" });
    assert.equal(await fileExists(task.result.filePath), true);

    const deleteResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}`, {
        method: "DELETE",
        headers: buildHeaders({ cookieSessionId: "session-a" }),
      }),
    );
    assert.equal(deleteResp.status, 200);
    assert.deepEqual(await deleteResp.json(), {
      ok: true,
      deletedTaskId: created.id,
    });
    assert.equal(await fileExists(task.result.filePath), false);

    const getResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}`, {
        headers: buildHeaders({ cookieSessionId: "session-a" }),
      }),
    );
    assert.equal(getResp.status, 404);
  } finally {
    await fixture.cleanup();
  }
});

test("tasks route cleans up missing artifacts from task list", async () => {
  const fixture = await createTasksAppFixture();

  try {
    const created = await createAlbumTask(fixture.app, {
      albumId: "missing-artifact",
      cookieSessionId: "session-a",
    });
    const task = await waitForTask(fixture.app, created.id, { cookieSessionId: "session-a" });

    await fs.rm(task.result.filePath, { force: true });

    const listResp = await fixture.app.request(
      new Request("http://localhost/api/tasks", {
        headers: buildHeaders({ cookieSessionId: "session-a" }),
      }),
    );
    assert.equal(listResp.status, 200);
    assert.deepEqual(await listResp.json(), []);

    const getResp = await fixture.app.request(
      new Request(`http://localhost/api/tasks/${created.id}`, {
        headers: buildHeaders({ cookieSessionId: "session-a" }),
      }),
    );
    assert.equal(getResp.status, 404);
  } finally {
    await fixture.cleanup();
  }
});

test("tasks route cleans up expired artifacts from task list", async () => {
  const fixture = await createTasksAppFixture({
    ttlMs: 60_000,
    cleanupIntervalMs: 1,
  });

  try {
    const created = await createAlbumTask(fixture.app, {
      albumId: "expired-artifact",
      cookieSessionId: "session-a",
    });
    const task = await waitForTask(fixture.app, created.id, { cookieSessionId: "session-a" });

    const expiredAt = new Date(Date.now() - 60_000);
    await fs.utimes(task.result.filePath, expiredAt, expiredAt);

    const listResp = await fixture.app.request(
      new Request("http://localhost/api/tasks", {
        headers: buildHeaders({ cookieSessionId: "session-a" }),
      }),
    );
    assert.equal(listResp.status, 200);
    assert.deepEqual(await listResp.json(), []);
    assert.equal(await fileExists(task.result.filePath), false);
  } finally {
    await fixture.cleanup();
  }
});

test("session expiry callback deletes session tasks and exported files", async () => {
  let nowMs = 0;
  const fixture = await createTasksAppFixture({
    createSessionManager: ({ taskManager, exportStore }) =>
      new JmSessionManager({
        ttlMs: 10,
        nowMs: () => nowMs,
        createClient: () => ({ marker: "client" } as any),
        onSessionExpired(sessionId) {
          const tasks = taskManager.listBySession(sessionId);
          taskManager.deleteBySession(sessionId);
          return Promise.all(
            tasks.map((task) =>
              task.result?.filePath ? exportStore.deleteZipIfExists(task.result.filePath) : Promise.resolve(false),
            ),
          ).then(() => undefined);
        },
      }),
  });

  try {
    const created = await createAlbumTask(fixture.app, {
      albumId: "session-expire",
      cookieSessionId: "session-a",
    });
    const task = await waitForTask(fixture.app, created.id, { cookieSessionId: "session-a" });
    assert.equal(await fileExists(task.result.filePath), true);

    nowMs = 20;
    const listResp = await fixture.app.request(
      new Request("http://localhost/api/tasks", {
        headers: buildHeaders({ cookieSessionId: "session-a" }),
      }),
    );
    assert.equal(listResp.status, 200);
    assert.deepEqual(await listResp.json(), []);
    assert.equal(await fileExists(task.result.filePath), false);
  } finally {
    await fixture.cleanup();
  }
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
