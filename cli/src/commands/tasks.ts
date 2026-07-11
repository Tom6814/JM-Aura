import { z } from "zod";

import type { HttpClient } from "../http";

const taskProgressSchema = z
  .object({
    total: z.number().int().nonnegative().nullable(),
    current: z.number().int().nonnegative(),
    currentLabel: z.string().nullable(),
  })
  .strict();

const taskErrorSchema = z
  .object({
    message: z.string(),
    stack: z.string().optional(),
  })
  .strict();

const taskZipResultSchema = z
  .object({
    filePath: z.string(),
    fileName: z.string(),
    size: z.number().int().nonnegative(),
  })
  .strict();

const taskSchema = z
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

const taskListSchema = z.array(taskSchema);

export async function runTasks(client: HttpClient, argv: string[]): Promise<void> {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") {
    printHelpAndExit();
  }

  if (sub === "list") {
    const list = await client.getJson("/api/tasks", taskListSchema);
    if (list.length === 0) {
      process.stdout.write("暂无任务。\n");
      return;
    }
    for (const task of list) {
      const total = task.progress.total ?? "?";
      process.stdout.write(`${task.id}\t${task.type}\t${task.status}\t${task.progress.current}/${total}\n`);
    }
    return;
  }

  if (sub === "status") {
    const id = argv[1] ?? "";
    if (!id) printHelpAndExit("缺少必需参数：<taskId>");
    const task = await client.getJson(`/api/tasks/${id}`, taskSchema);
    const total = task.progress.total ?? "?";
    process.stdout.write(`${task.id}\n`);
    process.stdout.write(`  type: ${task.type}\n`);
    process.stdout.write(`  status: ${task.status}\n`);
    process.stdout.write(`  progress: ${task.progress.current}/${total} ${task.progress.currentLabel ?? ""}\n`);
    if (task.result) {
      process.stdout.write(`  result: ${task.result.fileName} (${task.result.size} bytes)\n`);
    }
    if (task.error) {
      process.stdout.write(`  error: ${task.error.message}\n`);
    }
    return;
  }

  printHelpAndExit(`未知子命令：${sub}`);
}

function printHelpAndExit(error?: string): never {
  if (error) process.stderr.write(`${error}\n\n`);
  process.stderr.write(
    [
      "用法：",
      "  tsx cli/src/index.ts [--origin http://127.0.0.1:8787] tasks list",
      "  tsx cli/src/index.ts [--origin http://127.0.0.1:8787] tasks status <taskId>",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

