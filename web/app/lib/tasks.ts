import type { TaskSummary } from "./jm-rpc.server";

export type TaskStatusTone = "neutral" | "accent" | "success" | "error";

type TaskForSummary = Pick<TaskSummary, "type" | "status" | "progress" | "createdAt"> &
  Partial<Pick<TaskSummary, "result" | "error">>;

type TaskForBadges = Pick<TaskSummary, "id" | "type" | "status" | "progress" | "createdAt"> &
  Partial<Pick<TaskSummary, "result" | "error">>;

type TaskForDisplayTarget = Pick<TaskSummary, "type" | "metadata">;

export type TaskDownloadState = {
  href: string | null;
  label: string;
  hint: string;
  isReady: boolean;
};

type TaskDownloadOptions = {
  apiOrigin?: string;
};

export function mapTaskStatusTone(status: string): TaskStatusTone {
  switch (status) {
    case "running":
      return "accent";
    case "succeeded":
      return "success";
    case "failed":
    case "canceled":
      return "error";
    default:
      return "neutral";
  }
}

export function formatTaskStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "进行中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    default:
      return "等待中";
  }
}

export function formatTaskTypeLabel(type: string): string {
  switch (type) {
    case "export_favorites_zip":
      return "收藏夹下载";
    case "export_album_zip":
      return "作品下载";
    default:
      return "下载";
  }
}

export function formatTaskDisplayTarget(task: TaskForDisplayTarget): {
  title: string;
  subtitle: string | null;
  details: string | null;
} {
  if (task.metadata?.targetType === "album") {
    const title = task.metadata.albumTitle?.trim() || `本子 ${task.metadata.albumId ?? ""}`.trim();
    const jmLabel = task.metadata.albumId ? `JM ${task.metadata.albumId}` : null;
    const chapterDetail = formatSelectedChaptersDetail(task);
    return {
      title,
      subtitle: [jmLabel, typeof task.metadata.chapterCount === "number" && task.metadata.chapterCount > 1 ? `共 ${task.metadata.chapterCount} 话` : null]
        .filter(Boolean)
        .join(" · ") || null,
      details: chapterDetail,
    };
  }

  if (task.metadata?.targetType === "favorites") {
    return {
      title: task.metadata.folderName?.trim() || "收藏夹",
      subtitle: null,
      details: null,
    };
  }

  return {
    title: formatTaskTypeLabel(task.type),
    subtitle: null,
    details: null,
  };
}

export function formatTaskSummary(task: TaskForSummary): string {
  const prefix = formatTaskTypeLabel(task.type);
  const fileName = normalizeTaskFileName(task.result?.fileName);

  if (task.status === "running") {
    const progressParts = [formatProgress(task.progress)];
    if (task.progress.currentLabel) {
      progressParts.push(task.progress.currentLabel);
    }
    return `${prefix} · ${progressParts.filter(Boolean).join(" · ")}`;
  }

  if (task.status === "succeeded" && fileName) {
    return `${prefix} · 已生成 ${fileName}`;
  }

  if ((task.status === "failed" || task.status === "canceled") && task.error?.message) {
    return `${prefix} · ${task.error.message}`;
  }

  return `${prefix} · ${formatTaskStatusLabel(task.status)}`;
}

export function formatTaskTagList(task: TaskForBadges): string[] {
  const tags = [formatTaskTypeLabel(task.type), formatTaskStatusLabel(task.status)];

  if (task.status === "succeeded" && task.result?.fileName) {
    tags.push("可下载");
  } else if (task.status === "failed" || task.status === "canceled") {
    tags.push("需重试");
  }

  return tags;
}

export function getTaskDownloadState(task: TaskForBadges, options?: TaskDownloadOptions): TaskDownloadState {
  const fileName = normalizeTaskFileName(task.result?.fileName);

  if (task.status === "succeeded" && fileName) {
    return {
      href: buildTaskDownloadUrl(task.id, options?.apiOrigin),
      label: "下载 ZIP",
      hint: "下载文件通常保留 2 小时，过期后请重新发起下载。",
      isReady: true,
    };
  }

  if (task.status === "failed" || task.status === "canceled") {
    return {
      href: null,
      label: "暂不可下载",
      hint: "任务失败或已取消后需要重新发起下载。",
      isReady: false,
    };
  }

  return {
    href: null,
    label: task.status === "running" ? "处理中" : "暂不可下载",
    hint: "下载完成后即可在这里保存文件，过期后需要重新发起下载。",
    isReady: false,
  };
}

export function buildTaskDownloadPath(taskId: string): string {
  return `/api/tasks/${encodeURIComponent(taskId)}/download`;
}

export function buildTaskDownloadUrl(taskId: string, apiOrigin?: string): string {
  const path = buildTaskDownloadPath(taskId);
  if (!apiOrigin) return path;
  return new URL(path, apiOrigin).toString();
}

function formatProgress(progress: TaskSummary["progress"]): string {
  if (typeof progress.total === "number" && progress.total > 0) {
    return `已处理 ${progress.current} / ${progress.total}`;
  }

  if (progress.current > 0) {
    return `已处理 ${progress.current}`;
  }

  return "处理中";
}

function normalizeTaskFileName(fileName: string | undefined): string | null {
  const normalized = fileName?.trim();
  return normalized ? normalized : null;
}

function formatSelectedChaptersDetail(task: TaskForDisplayTarget): string | null {
  const chapters = task.metadata?.selectedChapters;
  if (!chapters || chapters.length === 0) {
    return null;
  }

  const labels = chapters.map((chapter) => {
    const title = normalizeChapterTitle(chapter.chapterTitle, chapter.chapterSort);
    return title ? `${title}（${chapter.chapterId}）` : chapter.chapterId;
  });

  return `章节：${labels.join("、")}`;
}

function normalizeChapterTitle(title?: string | null, sort?: string | null) {
  const normalizedTitle = title?.trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const normalizedSort = sort?.trim();
  if (normalizedSort) {
    return `第 ${normalizedSort} 话`;
  }

  return null;
}
