import { z } from "zod";
import path from "node:path";

import { ORDER_BY_VALUES } from "../../../packages/shared/src/schema";
import type { HttpClient } from "../http";
import { pollTaskUntilFinished } from "../http";
import { exportFavoritesAsClientZip } from "../clientZip";

const imageFormatSchema = z.enum(["original", "webp", "jpeg"]);
const orderBySchema = z.enum([...ORDER_BY_VALUES] as [string, ...string[]]);

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

const exportFavoritesTaskSchema = baseTaskSchema.extend({
  type: z.literal("export_favorites_zip"),
});

export async function runExportFavorites(client: HttpClient, argv: string[]): Promise<void> {
  const opts = parseExportFavoritesArgs(argv);
  if (opts.clientZip) {
    const outPath = await exportFavoritesAsClientZip({
      client,
      outDir: opts.outDir,
      folderId: opts.folderId,
      orderBy: opts.orderBy,
      imageFormat: opts.imageFormat,
      concurrency: opts.concurrency ?? 4,
    });
    process.stdout.write(`客户端打包完成：${outPath}\n`);
    return;
  }

  const created = await client.postJson(
    "/api/tasks/export/favorites",
    {
      folderId: opts.folderId,
      orderBy: opts.orderBy,
      imageFormat: opts.imageFormat,
      concurrency: opts.concurrency,
    },
    exportFavoritesTaskSchema,
    { expectedStatus: 201 },
  );

  process.stdout.write(`已创建任务：${created.id}\n`);

  let lastProgressKey = "";
  const finalTask = await pollTaskUntilFinished({
    fetchTask: async () => client.getJson(`/api/tasks/${created.id}`, exportFavoritesTaskSchema),
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

  process.stdout.write(`下载完成：${outPath} (${formatBytes(finalTask.result.size)})\n`);
}

function parseExportFavoritesArgs(argv: string[]): {
  outDir: string;
  folderId: string;
  orderBy: z.infer<typeof orderBySchema>;
  imageFormat: z.infer<typeof imageFormatSchema>;
  concurrency?: number;
  clientZip: boolean;
} {
  let outDir: string | null = null;
  let folderId = "0";
  let orderBy: z.infer<typeof orderBySchema> = "mr";
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
    if (token === "--folder-id") {
      folderId = (argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (token === "--order-by") {
      const v = argv[i + 1];
      i += 1;
      orderBy = orderBySchema.parse(v);
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
    throw new Error(`未知位置参数：${token}`);
  }

  if (!outDir) printHelpAndExit("缺少必需参数：--out <dir>");
  if (!folderId) printHelpAndExit("--folder-id 不能为空");

  return {
    outDir: path.resolve(outDir),
    folderId,
    orderBy,
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
      "  tsx cli/src/index.ts [--origin http://127.0.0.1:8787] export-favorites --out <dir> [--client-zip] [--folder-id 0] [--order-by mr|mv|mp|tf] [--image-format webp|jpeg|original] [--concurrency N]",
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
