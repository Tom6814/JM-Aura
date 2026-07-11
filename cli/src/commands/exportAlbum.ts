import { z } from "zod";
import path from "node:path";

import type { HttpClient } from "../http";
import { pollTaskUntilFinished } from "../http";
import { exportAlbumAsClientZip } from "../clientZip";

const imageFormatSchema = z.enum(["original", "webp", "jpeg"]);

const taskProgressSchema = z
  .object({
    total: z.number().int().nonnegative().nullable(),
    current: z.number().int().nonnegative(),
    currentLabel: z.string().nullable(),
  })
  .strict();

const taskZipResultSchema = z
  .object({
    filePath: z.string(),
    fileName: z.string().min(1),
    size: z.number().int().nonnegative(),
  })
  .strict();

const taskErrorSchema = z
  .object({
    message: z.string(),
    stack: z.string().optional(),
  })
  .strict();

const baseTaskSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
    createdAt: z.number().int().positive(),
    startedAt: z.number().int().positive().optional(),
    finishedAt: z.number().int().positive().optional(),
    progress: taskProgressSchema,
    result: taskZipResultSchema.optional(),
    error: taskErrorSchema.optional(),
  })
  .strict();

const exportAlbumTaskSchema = baseTaskSchema.extend({
  type: z.literal("export_album_zip"),
});

export async function runExportAlbum(client: HttpClient, argv: string[]): Promise<void> {
  const opts = parseExportAlbumArgs(argv);
  if (opts.clientZip) {
    const outPath = await exportAlbumAsClientZip({
      client,
      albumId: opts.albumId,
      outDir: opts.outDir,
      imageFormat: opts.imageFormat,
      concurrency: opts.concurrency ?? 4,
    });
    process.stdout.write(`客户端打包完成：${outPath}\n`);
    return;
  }

  const created = await client.postJson(
    "/api/tasks/export/album",
    {
      albumId: opts.albumId,
      imageFormat: opts.imageFormat,
      concurrency: opts.concurrency,
    },
    exportAlbumTaskSchema,
    { expectedStatus: 201 },
  );

  process.stdout.write(`已创建任务：${created.id}\n`);

  let lastProgressKey = "";
  const finalTask = await pollTaskUntilFinished({
    fetchTask: async () => client.getJson(`/api/tasks/${created.id}`, exportAlbumTaskSchema),
    isFinished: (t) => t.status === "succeeded" || t.status === "failed" || t.status === "canceled",
    onTick: (t) => {
      const total = t.progress.total ?? "?";
      const key = `${t.status}:${t.progress.current}/${total}:${t.progress.currentLabel ?? ""}`;
      if (key !== lastProgressKey) {
        lastProgressKey = key;
        const label = t.progress.currentLabel ? ` ${t.progress.currentLabel}` : "";
        process.stdout.write(`任务状态：${t.status} ${t.progress.current}/${total}${label}\n`);
      }
    },
  });

  if (finalTask.status !== "succeeded" || !finalTask.result) {
    const msg = finalTask.error?.message ?? `任务未成功结束（status=${finalTask.status}）`;
    throw new Error(msg);
  }

  const outPath = await client.downloadToDirectory(
    `/api/tasks/${finalTask.id}/download`,
    opts.outDir,
    finalTask.result.fileName,
  );

  process.stdout.write(
    `下载完成：${outPath} (${formatBytes(finalTask.result.size)})\n`,
  );
}

function parseExportAlbumArgs(argv: string[]): {
  albumId: string;
  outDir: string;
  imageFormat: z.infer<typeof imageFormatSchema>;
  concurrency?: number;
  clientZip: boolean;
} {
  const positionals: string[] = [];
  let outDir: string | null = null;
  let imageFormat: z.infer<typeof imageFormatSchema> = "original";
  let concurrency: number | undefined;
  let clientZip = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--out") {
      outDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--client-zip") {
      clientZip = true;
      continue;
    }
    if (token === "--image-format") {
      const v = argv[i + 1];
      i += 1;
      imageFormat = imageFormatSchema.parse(v);
      continue;
    }
    if (token === "--concurrency") {
      const v = argv[i + 1];
      i += 1;
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error("--concurrency 必须是正整数");
      concurrency = n;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelpAndExit();
    }
    if (token.startsWith("--")) {
      throw new Error(`未知参数：${token}`);
    }
    positionals.push(token);
  }

  const albumId = positionals[0] ?? "";
  if (!albumId) printHelpAndExit("缺少必需参数：<albumId>");
  if (!outDir) printHelpAndExit("缺少必需参数：--out <dir>");

  return {
    albumId,
    outDir: path.resolve(outDir),
    imageFormat,
    concurrency,
    clientZip,
  };
}

function printHelpAndExit(error?: string): never {
  if (error) process.stderr.write(`${error}\n\n`);
  process.stderr.write(
    [
      "用法：",
      "  tsx cli/src/index.ts [--origin http://127.0.0.1:8787] export-album <albumId> --out <dir> [--client-zip] [--image-format webp|jpeg|original] [--concurrency N]",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size)) return String(size);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MiB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}
