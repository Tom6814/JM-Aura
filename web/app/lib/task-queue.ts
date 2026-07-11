import type { TaskSummary } from "./jm-rpc.server";

const ACTIVE_TASK_STATUSES = new Set(["queued", "running"]);

export function sortTaskQueueItems(tasks: TaskSummary[]) {
  return [...tasks].sort((left, right) => {
    const leftPriority = getTaskPriority(left.status);
    const rightPriority = getTaskPriority(right.status);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return right.createdAt - left.createdAt;
  });
}

export function partitionTaskQueue(tasks: TaskSummary[]) {
  const activeTasks: TaskSummary[] = [];
  const historyTasks: TaskSummary[] = [];

  for (const task of tasks) {
    if (ACTIVE_TASK_STATUSES.has(task.status)) {
      activeTasks.push(task);
    } else {
      historyTasks.push(task);
    }
  }

  return {
    activeTasks: stableSortTasks(activeTasks, (left, right) => right.createdAt - left.createdAt),
    historyTasks: stableSortTasks(historyTasks, (left, right) => {
      const rightTime = right.finishedAt ?? right.createdAt;
      const leftTime = left.finishedAt ?? left.createdAt;
      return rightTime - leftTime;
    }),
  };
}

export function getTaskProgressSnapshot(task: Pick<TaskSummary, "status" | "progress">) {
  if (typeof task.progress.total === "number" && task.progress.total > 0) {
    const rawPercent = (task.progress.current / task.progress.total) * 100;
    return {
      current: task.progress.current,
      total: task.progress.total,
      percent: Math.max(0, Math.min(100, Math.round(rawPercent))),
      determinate: true,
      label: `已处理 ${task.progress.current} / ${task.progress.total}`,
    };
  }

  if (task.status === "queued") {
    return {
      current: task.progress.current,
      total: null,
      percent: null,
      determinate: false,
      label: "等待处理中",
    };
  }

  return {
    current: task.progress.current,
    total: null,
    percent: null,
    determinate: false,
    label: task.progress.current > 0 ? `已处理 ${task.progress.current}` : "处理中",
  };
}

export function buildTaskQueueOverview(tasks: TaskSummary[]) {
  const { activeTasks, historyTasks } = partitionTaskQueue(tasks);

  return {
    total: tasks.length,
    active: activeTasks.length,
    completed: historyTasks.filter((task) => task.status === "succeeded").length,
    failed: historyTasks.filter((task) => task.status === "failed" || task.status === "canceled").length,
  };
}

export function shouldAutoRefreshTaskQueue(input: {
  visibilityState: string;
  revalidatorState: string;
  tasks: TaskSummary[];
}) {
  if (input.visibilityState !== "visible") {
    return false;
  }

  if (input.revalidatorState !== "idle") {
    return false;
  }

  return input.tasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status));
}

export function findAutoDownloadTaskId(input: {
  previousTasks: TaskSummary[];
  nextTasks: TaskSummary[];
  handledTaskIds: Set<string>;
}) {
  const previousById = new Map(input.previousTasks.map((task) => [task.id, task]));

  for (const task of input.nextTasks) {
    if (task.status !== "succeeded" || !task.result?.fileName) {
      continue;
    }

    if (input.handledTaskIds.has(task.id)) {
      continue;
    }

    const previous = previousById.get(task.id);
    if (!previous || previous.status === "succeeded") {
      continue;
    }

    return task.id;
  }

  return null;
}

function getTaskPriority(status: TaskSummary["status"]) {
  switch (status) {
    case "running":
      return 0;
    case "queued":
      return 1;
    case "failed":
      return 2;
    case "canceled":
      return 3;
    case "succeeded":
      return 4;
    default:
      return 5;
  }
}

function stableSortTasks(
  tasks: TaskSummary[],
  compare: (left: TaskSummary, right: TaskSummary) => number,
) {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => compare(left.task, right.task) || left.index - right.index)
    .map(({ task }) => task);
}
