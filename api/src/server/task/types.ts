import { z } from "zod";

/**
 * Task types that the backend supports.
 *
 * Notes:
 * - Keep this list in sync with routes / CLI as they are added.
 * - Using Zod here makes it easy to validate API payloads later.
 */
export const TaskTypeSchema = z.enum(["export_album_zip", "export_favorites_zip"]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "canceled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskProgressSchema = z.object({
  total: z.number().int().nonnegative().nullable(),
  current: z.number().int().nonnegative(),
  currentLabel: z.string().nullable(),
});
export type TaskProgress = z.infer<typeof TaskProgressSchema>;

export const TaskMetadataSchema = z
  .object({
    targetType: z.enum(["album", "favorites"]),
    albumId: z.string().optional(),
    albumTitle: z.string().nullable().optional(),
    chapterCount: z.number().int().positive().nullable().optional(),
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
    folderId: z.string().nullable().optional(),
    folderName: z.string().nullable().optional(),
  })
  .strict();
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

/**
 * Common result for "export_*_zip" tasks.
 * (Task 6+ will actually write the file; for Task 3 tests it's a fake path.)
 */
export const TaskZipResultSchema = z.object({
  filePath: z.string(),
  fileName: z.string(),
  size: z.number().int().nonnegative(),
});
export type TaskZipResult = z.infer<typeof TaskZipResultSchema>;

export type TaskResultByType = {
  export_album_zip: TaskZipResult;
  export_favorites_zip: TaskZipResult;
};

export type TaskResult<TType extends TaskType = TaskType> = TaskResultByType[TType];

export type TaskErrorInfo = {
  message: string;
  stack?: string;
};

export type Task<TType extends TaskType = TaskType> = {
  id: string;
  sessionId: string;
  type: TType;
  status: TaskStatus;
  createdAt: number;
  metadata?: TaskMetadata;
  startedAt?: number;
  finishedAt?: number;
  progress: TaskProgress;
  result?: TaskResult<TType>;
  error?: TaskErrorInfo;
};
