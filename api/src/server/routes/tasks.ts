import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";

import type { TaskManager } from "../task/taskManager";
import type { ExportStore } from "../export/exportStore";
import { buildDeviceSessionCookieHeaderValue, type JmSessionManager, type SessionContext } from "../session";
import { exportAlbumToZip as exportAlbumToZipImpl, exportFavoritesToZip as exportFavoritesToZipImpl } from "../export/zipExporter";

type ExportAlbumToZipFn = typeof exportAlbumToZipImpl;
type ExportFavoritesToZipFn = typeof exportFavoritesToZipImpl;

const DEFAULT_TASK_RUNNER_TIMEOUT_MS = Math.max(1, Number(process.env.TASK_RUNNER_TIMEOUT_MS ?? 15 * 60 * 1000) || 15 * 60 * 1000);

export type CreateTasksRouterOptions = {
  taskManager: TaskManager;
  exportStore: ExportStore;
  sessionManager: JmSessionManager;
  /**
   * Test seam. Defaults to real implementation.
   */
  exportAlbumToZip?: ExportAlbumToZipFn;
  /**
   * Test seam. Defaults to real implementation.
   */
  exportFavoritesToZip?: ExportFavoritesToZipFn;
};

const idParamSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

const exportAlbumBodySchema = z
  .object({
    albumId: z.string().min(1),
    chapterIds: z.array(z.string().min(1)).optional(),
    selectedChapters: z
      .array(
        z
          .object({
            chapterId: z.string().min(1),
            chapterTitle: z.string().nullable().optional(),
            chapterSort: z.string().nullable().optional(),
          })
          .strict(),
      )
      .optional(),
    imageFormat: z.enum(["original", "webp", "jpeg"]).optional().default("webp"),
    concurrency: z.coerce.number().int().positive().optional(),
  })
  .strict();

const exportFavoritesBodySchema = z
  .object({
    folderId: z.string().min(1).optional().default("0"),
    orderBy: z.string().min(1).optional().default("mr"),
    imageFormat: z.enum(["original", "webp", "jpeg"]).optional().default("webp"),
    concurrency: z.coerce.number().int().positive().optional(),
  })
  .strict();

export function createTasksRouter(options: CreateTasksRouterOptions) {
  const { taskManager, exportStore, sessionManager } = options;
  const exportAlbumToZip = options.exportAlbumToZip ?? exportAlbumToZipImpl;
  const exportFavoritesToZip = options.exportFavoritesToZip ?? exportFavoritesToZipImpl;

  const router = new Hono();

  router.get("/api/tasks", async (c) => {
    const session = sessionManager.get(c.req.raw);
    applySessionCookieIfNeeded(c, session);
    await prepareTaskArtifacts(taskManager, exportStore);
    return c.json(taskManager.listBySession(session.sessionId));
  });

  router.post("/api/tasks/export/album", zValidator("json", exportAlbumBodySchema), async (c) => {
    const session = sessionManager.get(c.req.raw);
    applySessionCookieIfNeeded(c, session);
    const jmClient = session.client;
    const { albumId, chapterIds, selectedChapters, imageFormat, concurrency } = c.req.valid("json");
    const albumTitle = await resolveAlbumTitle(jmClient, albumId);

    await prepareTaskArtifacts(taskManager, exportStore);

    let taskId = "";
    const task = taskManager.create(
      "export_album_zip",
      session.sessionId,
      async () => {
        const zipPath = exportStore.getZipPath(taskId);
        await exportAlbumToZip({
          jmClient,
          albumId,
          chapterIds,
          zipPath,
          imageFormat,
          concurrency,
          logger: createRouteLogger("export_album_zip", taskId),
        });
        const st = await fs.stat(zipPath);
        return {
          filePath: zipPath,
          fileName: exportStore.getZipFileName(taskId, `album-${albumId}`),
          size: st.size,
        };
      },
      {
        retry: {
          maxAttempts: 2,
          timeoutMs: DEFAULT_TASK_RUNNER_TIMEOUT_MS,
        },
      },
      {
        targetType: "album",
        albumId,
        albumTitle,
        chapterCount: chapterIds?.length ? chapterIds.length : null,
        selectedChapters:
          selectedChapters?.length
            ? selectedChapters.map((chapter) => ({
                chapterId: chapter.chapterId,
                chapterTitle: chapter.chapterTitle ?? null,
                chapterSort: chapter.chapterSort ?? null,
              }))
            : undefined,
      },
    );
    taskId = task.id;

    // Fire-and-forget. The caller should poll via GET /api/tasks/:id.
    void taskManager.run(task.id).catch(() => null);

    return c.json(task, 201);
  });

  router.post("/api/tasks/export/favorites", zValidator("json", exportFavoritesBodySchema), async (c) => {
    const session = sessionManager.get(c.req.raw);
    applySessionCookieIfNeeded(c, session);
    const jmClient = session.client;
    const { folderId, orderBy, imageFormat, concurrency } = c.req.valid("json");

    await prepareTaskArtifacts(taskManager, exportStore);

    let taskId = "";
    const task = taskManager.create(
      "export_favorites_zip",
      session.sessionId,
      async () => {
        const zipPath = exportStore.getZipPath(taskId);
        await exportFavoritesToZip({
          jmClient,
          zipPath,
          folderId,
          orderBy,
          imageFormat,
          concurrency,
          logger: createRouteLogger("export_favorites_zip", taskId),
        });
        const st = await fs.stat(zipPath);
        return {
          filePath: zipPath,
          fileName: exportStore.getZipFileName(taskId, `favorites-${folderId}`),
          size: st.size,
        };
      },
      {
        retry: {
          maxAttempts: 2,
          timeoutMs: DEFAULT_TASK_RUNNER_TIMEOUT_MS,
        },
      },
      {
        targetType: "favorites",
        folderId,
        folderName: getFavoritesFolderName(folderId),
      },
    );
    taskId = task.id;

    void taskManager.run(task.id).catch(() => null);

    return c.json(task, 201);
  });

  router.get("/api/tasks/:id", zValidator("param", idParamSchema), async (c) => {
    const session = sessionManager.get(c.req.raw);
    applySessionCookieIfNeeded(c, session);
    await prepareTaskArtifacts(taskManager, exportStore);
    const { id } = c.req.valid("param");
    const task = taskManager.getOwnedTask(session.sessionId, id);
    if (!task) return c.json({ error: "任务不存在" }, 404);
    return c.json(task);
  });

  router.post("/api/tasks/:id/cancel", zValidator("param", idParamSchema), async (c) => {
    const session = sessionManager.get(c.req.raw);
    applySessionCookieIfNeeded(c, session);
    await prepareTaskArtifacts(taskManager, exportStore);
    const { id } = c.req.valid("param");
    const task = taskManager.getOwnedTask(session.sessionId, id);
    if (!task) return c.json({ error: "任务不存在" }, 404);
    taskManager.cancel(id);
    return c.json(taskManager.getOwnedTask(session.sessionId, id));
  });

  router.get("/api/tasks/:id/download", zValidator("param", idParamSchema), async (c) => {
    const session = sessionManager.get(c.req.raw);
    applySessionCookieIfNeeded(c, session);
    const { id } = c.req.valid("param");
    await prepareTaskArtifacts(taskManager, exportStore);
    const task = taskManager.getOwnedTask(session.sessionId, id);

    // For download, the client doesn't really care whether it's the task missing
    // or the artifact missing; unify to EXPORT_NOT_FOUND.
    if (!task) return c.json({ error: "导出文件不存在", code: "EXPORT_NOT_FOUND" }, 404);

    if (task.status !== "succeeded" || !task.result?.filePath) {
      return c.json({ error: "导出尚未完成", code: "EXPORT_NOT_READY" }, 409);
    }

    const zipPath = task.result.filePath;
    const fileName = task.result.fileName || exportStore.getZipFileName(id);

    let st: import("node:fs").Stats;
    try {
      st = await fs.stat(zipPath);
    } catch (err: unknown) {
      if (isErrno(err, "ENOENT")) {
        taskManager.deleteOwnedTask(session.sessionId, id);
        return c.json({ error: "导出文件不存在", code: "EXPORT_NOT_FOUND" }, 404);
      }
      throw err;
    }

    if (exportStore.isExpired(st.mtimeMs)) {
      await exportStore.deleteZipIfExists(zipPath);
      taskManager.deleteOwnedTask(session.sessionId, id);
      return c.json({ error: "导出文件已过期", code: "EXPORT_EXPIRED" }, 404);
    }

    const headers = new Headers();
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Length", String(st.size));
    headers.set("Content-Disposition", buildContentDisposition(fileName));
    headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    const stream: ReadStream = createReadStream(zipPath);
    return new Response(stream as any, { status: 200, headers });
  });

  router.delete("/api/tasks/:id", zValidator("param", idParamSchema), async (c) => {
    const session = sessionManager.get(c.req.raw);
    applySessionCookieIfNeeded(c, session);
    await prepareTaskArtifacts(taskManager, exportStore);

    const { id } = c.req.valid("param");
    const task = taskManager.getOwnedTask(session.sessionId, id);
    if (!task) return c.json({ error: "任务不存在" }, 404);

    taskManager.cancel(id);
    if (task.result?.filePath) {
      await exportStore.deleteZipIfExists(task.result.filePath);
    }
    taskManager.deleteOwnedTask(session.sessionId, id);

    return c.json({ ok: true, deletedTaskId: id });
  });

  return router;
}

async function prepareTaskArtifacts(taskManager: TaskManager, exportStore: ExportStore): Promise<void> {
  await exportStore.ensureRootDir();
  await exportStore.cleanupIfDue();
  await cleanupMissingArtifacts(taskManager, exportStore);
}

async function cleanupMissingArtifacts(taskManager: TaskManager, exportStore: ExportStore): Promise<void> {
  const tasks = taskManager.list();
  const nowMs = Date.now();

  await Promise.all(
    tasks.map(async (task) => {
      if (task.status !== "succeeded" || !task.result?.filePath) return;

      let st: import("node:fs").Stats;
      try {
        st = await fs.stat(task.result.filePath);
      } catch (err: unknown) {
        if (isErrno(err, "ENOENT")) {
          taskManager.deleteOwnedTask(task.sessionId, task.id);
          return;
        }
        throw err;
      }

      if (!exportStore.isExpired(st.mtimeMs, nowMs)) return;

      await exportStore.deleteZipIfExists(task.result.filePath);
      taskManager.deleteOwnedTask(task.sessionId, task.id);
    }),
  );
}

function applySessionCookieIfNeeded(c: Context, session: SessionContext) {
  const hasHeaderSession = c.req.raw.headers.get("x-jm-session")?.trim();
  if (!session.isNew || hasHeaderSession) return;
  c.header("Set-Cookie", buildDeviceSessionCookieHeaderValue(session.sessionId));
}

function buildContentDisposition(fileName: string): string {
  // RFC 6266: include both filename and filename* for better compatibility.
  const fallback = fileName.replace(/["\\\r\n]/g, "_");
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as any).code === code
  );
}

function createRouteLogger(taskType: string, taskId: string) {
  return {
    info(message: string, meta?: Record<string, unknown>) {
      console.info(message, { taskType, taskId, ...(meta ?? {}) });
    },
    warn(message: string, meta?: Record<string, unknown>) {
      console.warn(message, { taskType, taskId, ...(meta ?? {}) });
    },
    error(message: string, meta?: Record<string, unknown>) {
      console.error(message, { taskType, taskId, ...(meta ?? {}) });
    },
  };
}

async function resolveAlbumTitle(jmClient: unknown, albumId: string): Promise<string | null> {
  if (
    typeof jmClient !== "object" ||
    jmClient === null ||
    !("fetchAlbumDetail" in jmClient) ||
    typeof jmClient.fetchAlbumDetail !== "function"
  ) {
    return null;
  }

  const albumDetail = await jmClient.fetchAlbumDetail(albumId).catch(() => null);
  if (typeof albumDetail !== "object" || albumDetail === null || !("data" in albumDetail)) {
    return null;
  }

  const { data } = albumDetail;
  if (typeof data !== "object" || data === null || !("name" in data) || typeof data.name !== "string") {
    return null;
  }

  return data.name;
}

function getFavoritesFolderName(folderId: string): string {
  return folderId === "0" ? "全部收藏" : `收藏夹 ${folderId}`;
}
