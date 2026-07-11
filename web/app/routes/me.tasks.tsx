import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

import { TaskQueuePanel } from "../components/task-queue";
import { DocumentNavigationLink, SectionHeader } from "../components/ui";
import { deleteTask, fetchTaskList, getApiOrigin, type TaskSummary } from "../lib/jm-rpc.server";
import { buildTaskDownloadUrl } from "../lib/tasks";
import { findAutoDownloadTaskId, shouldAutoRefreshTaskQueue } from "../lib/task-queue";

export const meTasksLoaderDependencies = {
  fetchTaskList,
  getApiOrigin,
};

export const meTasksActionDependencies = {
  deleteTask,
};

type TasksPageData = {
  apiOrigin: string;
  page: number;
  pageSize: number;
  tasks: TaskSummary[];
};

type MeTasksRefreshStateInput = {
  visibilityState: string;
  revalidatorState: string;
  tasks: TaskSummary[];
};

type DeleteTaskActionData =
  | {
      intent: "delete_task";
      ok: true;
      deletedTaskId: string;
    }
  | {
      intent: string;
      ok: false;
      message: string;
    };

export const meta: MetaFunction = () => [{ title: "下载 | JM Aura Remix" }];

function normalizePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const page = normalizePositiveInt(url.searchParams.get("page"), 1);
  const pageSize = 20;

  return json({
    apiOrigin: meTasksLoaderDependencies.getApiOrigin(request),
    page,
    pageSize,
    tasks: await meTasksLoaderDependencies.fetchTaskList(request).catch(() => []),
  } satisfies TasksPageData);
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent !== "delete_task") {
    return json(
      {
        intent,
        ok: false,
        message: "暂不支持的下载页操作。",
      } satisfies DeleteTaskActionData,
      { status: 400 },
    );
  }

  const taskId = String(formData.get("taskId") ?? "").trim();
  if (!taskId) {
    return json(
      {
        intent,
        ok: false,
        message: "缺少任务 ID。",
      } satisfies DeleteTaskActionData,
      { status: 400 },
    );
  }

  try {
    const result = await meTasksActionDependencies.deleteTask(request, taskId);
    return json({
      intent,
      ok: true,
      deletedTaskId: result.deletedTaskId,
    } satisfies DeleteTaskActionData);
  } catch (error) {
    return json(
      {
        intent,
        ok: false,
        message: error instanceof Error ? error.message : "删除任务失败，请稍后重试。",
      } satisfies DeleteTaskActionData,
      { status: 400 },
    );
  }
}

export function getMeTasksRefreshState(input: MeTasksRefreshStateInput) {
  const hasActiveTasks = input.tasks.some((task) => task.status === "queued" || task.status === "running");

  return {
    shouldRefresh: shouldAutoRefreshTaskQueue(input),
    refreshing: hasActiveTasks && input.revalidatorState !== "idle",
  };
}

export function getCompletedDeleteTaskId(input: {
  fetcherState: string;
  data: DeleteTaskActionData | undefined;
}) {
  if (input.fetcherState !== "idle") {
    return null;
  }

  if (!input.data || input.data.intent !== "delete_task" || input.data.ok !== true) {
    return null;
  }

  return input.data.deletedTaskId;
}

export default function MeTasksRoute() {
  const data = useLoaderData<typeof loader>() as unknown as TasksPageData;
  const deleteFetcher = useFetcher<DeleteTaskActionData>();
  const revalidator = useRevalidator();
  const previousTasksRef = useRef<TaskSummary[]>(data.tasks);
  const handledAutoDownloadsRef = useRef<Set<string>>(new Set());
  const handledDeleteTaskIdsRef = useRef<Set<string>>(new Set());
  const [visibilityState, setVisibilityState] = useState(() =>
    typeof document === "undefined" ? "visible" : document.visibilityState,
  );
  const pageCount = Math.max(1, Math.ceil(data.tasks.length / data.pageSize));
  const deletingTaskId =
    deleteFetcher.state !== "idle"
      ? String(deleteFetcher.formData?.get("taskId") ?? "").trim() || null
      : null;
  const refreshState = getMeTasksRefreshState({
    visibilityState,
    revalidatorState: revalidator.state,
    tasks: data.tasks,
  });

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const onVisibilityChange = () => {
      setVisibilityState(document.visibilityState);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!refreshState.shouldRefresh) {
      return;
    }

    const timerId = window.setInterval(() => {
      revalidator.revalidate();
    }, 3000);

    return () => window.clearInterval(timerId);
  }, [refreshState.shouldRefresh, revalidator]);

  useEffect(() => {
    const deletedTaskId = getCompletedDeleteTaskId({
      fetcherState: deleteFetcher.state,
      data: deleteFetcher.data,
    });

    if (!deletedTaskId || handledDeleteTaskIdsRef.current.has(deletedTaskId)) {
      return;
    }

    handledDeleteTaskIdsRef.current.add(deletedTaskId);
    revalidator.revalidate();
  }, [deleteFetcher.data, deleteFetcher.state, revalidator]);

  useEffect(() => {
    if (typeof document === "undefined") {
      previousTasksRef.current = data.tasks;
      return;
    }

    const taskId = findAutoDownloadTaskId({
      previousTasks: previousTasksRef.current,
      nextTasks: data.tasks,
      handledTaskIds: handledAutoDownloadsRef.current,
    });

    previousTasksRef.current = data.tasks;

    if (!taskId) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = buildTaskDownloadUrl(taskId, data.apiOrigin);
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    handledAutoDownloadsRef.current.add(taskId);
  }, [data.apiOrigin, data.tasks]);

  const handleDeleteTask = (taskId: string) => {
    const formData = new FormData();
    formData.set("intent", "delete_task");
    formData.set("taskId", taskId);
    deleteFetcher.submit(formData, { method: "post" });
  };

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader
        eyebrow="我的"
        title="下载"
        description="任务与队列"
        action={
          <DocumentNavigationLink className="md-button md-button--surface" to="/me">
            设置
          </DocumentNavigationLink>
        }
      />
      <TaskQueuePanel
        apiOrigin={data.apiOrigin}
        tasks={data.tasks}
        page={data.page}
        pageCount={pageCount}
        pageSize={data.pageSize}
        deletingTaskId={deletingTaskId}
        onDeleteTask={handleDeleteTask}
        refreshing={refreshState.refreshing}
      />
    </div>
  );
}
