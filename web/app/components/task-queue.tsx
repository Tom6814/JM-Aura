import type { ReactNode } from "react";
import { DocumentNavigationLink, EmptyPanel, SectionHeader } from "./ui";
import type { TaskSummary } from "../lib/jm-rpc.server";
import {
  formatTaskDisplayTarget,
  formatTaskStatusLabel,
  getTaskDownloadState,
  mapTaskStatusTone,
} from "../lib/tasks";
import {
  buildTaskQueueOverview,
  getTaskProgressSnapshot,
  partitionTaskQueue,
} from "../lib/task-queue";

type TaskQueuePanelProps = {
  apiOrigin?: string;
  tasks: TaskSummary[];
  page: number;
  pageSize: number;
  pageCount: number;
  refreshing?: boolean;
  deletingTaskId?: string | null;
  onDeleteTask?: (taskId: string) => void;
};

export function TaskQueuePanel(props: TaskQueuePanelProps) {
  const { activeTasks, historyTasks } = partitionTaskQueue(props.tasks);
  const overview = buildTaskQueueOverview(props.tasks);
  const historyPageCount = Math.max(1, Math.ceil(historyTasks.length / props.pageSize));
  const currentPage = Math.min(props.page, historyPageCount);
  const start = (currentPage - 1) * props.pageSize;
  const historyPageItems = historyTasks.slice(start, start + props.pageSize);

  return (
    <div className="task-queue">
      <section className="task-queue__overview">
        <TaskQueueStatCard label="任务总数" value={overview.total} />
        <TaskQueueStatCard label="进行中" value={overview.active} highlight="accent" />
        <TaskQueueStatCard label="已完成" value={overview.completed} highlight="success" />
        <TaskQueueStatCard label="失败/取消" value={overview.failed} highlight="error" />
      </section>

      {props.tasks.length === 0 ? (
        <EmptyPanel
          title="还没有下载任务"
          description="在收藏页或漫画详情页发起下载后，这里会出现任务记录和进度。"
        />
      ) : (
        <>
          <TaskQueueSection
            title="进行中"
            description={
              activeTasks.length > 0
                ? props.refreshing
                  ? `共 ${activeTasks.length} 个任务 · 正在刷新进度`
                  : `共 ${activeTasks.length} 个任务`
                : "当前没有正在执行的任务。"
            }
          >
            {activeTasks.length > 0 ? (
              <div className="task-queue__list task-queue__list--active">
                {activeTasks.map((task) => (
                  <TaskQueueActiveCard key={task.id} task={task} apiOrigin={props.apiOrigin} />
                ))}
              </div>
            ) : (
              <p className="task-queue__empty-copy">新的下载任务创建后，会优先出现在这里。</p>
            )}
          </TaskQueueSection>

          <TaskQueueSection
            title="已完成与失败"
            description={
              historyTasks.length > 0
                ? historyPageCount > 1
                  ? `共 ${historyTasks.length} 条结果 · 第 ${currentPage} / ${historyPageCount} 页`
                  : `共 ${historyTasks.length} 条结果`
                : "历史结果会在下载完成或失败后出现在这里。"
            }
          >
            {historyPageItems.length > 0 ? (
              <>
                <div className="task-queue__list task-queue__list--history">
                  {historyPageItems.map((task) => (
                    <TaskQueueHistoryCard
                      key={task.id}
                      task={task}
                      apiOrigin={props.apiOrigin}
                      deleting={props.deletingTaskId === task.id}
                      onDelete={props.onDeleteTask}
                    />
                  ))}
                </div>

                {historyPageCount > 1 ? (
                  <nav className="me-pagination" aria-label="任务分页">
                    <DocumentNavigationLink
                      className="md-button md-button--surface"
                      to={`/me/tasks?page=${Math.max(1, currentPage - 1)}`}
                      aria-disabled={currentPage <= 1}
                    >
                      上一页
                    </DocumentNavigationLink>
                    <span className="me-pagination__meta">{`第 ${currentPage} / ${historyPageCount} 页`}</span>
                    <DocumentNavigationLink
                      className="md-button md-button--surface"
                      to={`/me/tasks?page=${Math.min(historyPageCount, currentPage + 1)}`}
                      aria-disabled={currentPage >= historyPageCount}
                    >
                      下一页
                    </DocumentNavigationLink>
                  </nav>
                ) : null}
              </>
            ) : (
              <p className="task-queue__empty-copy">最近的下载结果会集中保留在这里，方便重新下载或排查失败原因。</p>
            )}
          </TaskQueueSection>
        </>
      )}
    </div>
  );
}

function TaskQueueSection(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="md-card task-queue__panel">
      <SectionHeader eyebrow="下载队列" title={props.title} description={props.description} />
      {props.children}
    </section>
  );
}

function TaskQueueActiveCard(props: { task: TaskSummary; apiOrigin?: string }) {
  const target = formatTaskDisplayTarget(props.task);
  const tone = mapTaskStatusTone(props.task.status);
  const progress = getTaskProgressSnapshot(props.task);
  const download = getTaskDownloadState(props.task, { apiOrigin: props.apiOrigin });

  return (
    <article id={`task-${props.task.id}`} className={`task-queue__card task-queue__card--${tone}`}>
      <div className="task-queue__card-head">
        <div className="task-queue__summary">
          <strong className="task-queue__title">{target.title}</strong>
          <div className="task-queue__summary-meta">
            {target.subtitle ? <span>{target.subtitle}</span> : null}
            {target.details ? <span>{target.details}</span> : null}
            <span>任务 ID：{props.task.id}</span>
          </div>
        </div>
        <span className={`task-queue__status task-queue__status--${tone}`}>
          {formatTaskStatusLabel(props.task.status)}
        </span>
      </div>

      <div className="task-queue__progress">
        <div
          className={`task-queue__progress-bar${progress.determinate ? "" : " task-queue__progress-bar--indeterminate"}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent ?? undefined}
          aria-label={progress.label}
        >
          <span className="task-queue__progress-fill" style={{ width: `${progress.percent ?? 36}%` }} />
        </div>
        <div className="task-queue__progress-copy">
          <strong>{progress.label}</strong>
          <span>{props.task.progress.currentLabel ?? "等待下一步状态…"}</span>
        </div>
      </div>

      <div className="task-queue__meta">
        <span>创建于 {formatTaskDate(props.task.createdAt)}</span>
        <span>{download.hint}</span>
      </div>
    </article>
  );
}

function TaskQueueHistoryCard(props: {
  task: TaskSummary;
  apiOrigin?: string;
  deleting?: boolean;
  onDelete?: (taskId: string) => void;
}) {
  const target = formatTaskDisplayTarget(props.task);
  const tone = mapTaskStatusTone(props.task.status);
  const download = getTaskDownloadState(props.task, { apiOrigin: props.apiOrigin });
  const finishedLabel = props.task.finishedAt ? formatTaskDate(props.task.finishedAt) : formatTaskDate(props.task.createdAt);
  const resultTitle = props.task.status === "succeeded" ? "结果已就绪" : "任务未完成";

  return (
    <article id={`task-${props.task.id}`} className={`task-queue__card task-queue__card--${tone} task-queue__card--history`}>
      <div className="task-queue__card-head">
        <div className="task-queue__summary">
          <strong className="task-queue__title">{target.title}</strong>
          <div className="task-queue__summary-meta">
            {target.subtitle ? <span>{target.subtitle}</span> : null}
            {target.details ? <span>{target.details}</span> : null}
            <span>{resultTitle}</span>
          </div>
        </div>
        <span className={`task-queue__status task-queue__status--${tone}`}>
          {formatTaskStatusLabel(props.task.status)}
        </span>
      </div>

      <div className={`task-queue__result task-queue__result--${tone}`}>
        <div className={`task-queue__result-bar${props.task.status === "succeeded" ? " task-queue__result-bar--success" : ""}`} aria-hidden="true" />
        <div className="task-queue__result-copy">
          <strong>{props.task.status === "succeeded" ? "文件已生成，可直接保存 ZIP。" : props.task.error?.message ?? "任务中断，请重新发起下载。"}</strong>
          <span>{download.hint}</span>
        </div>
      </div>

      <div className="task-queue__actions">
        {download.href ? (
          <a className="md-button md-button--primary task-queue__download-button" href={download.href}>
            {download.label}
          </a>
        ) : (
          <span className="md-button md-button--surface task-queue__download-button" aria-disabled="true">
            {download.label}
          </span>
        )}
        <button
          type="button"
          className="md-button md-button--surface"
          onClick={() => props.onDelete?.(props.task.id)}
          disabled={props.deleting || !props.onDelete}
        >
          {props.deleting ? "删除中..." : "删除任务"}
        </button>
        <div className="task-queue__meta">
          <span>{props.task.status === "succeeded" ? `完成于 ${finishedLabel}` : `结束于 ${finishedLabel}`}</span>
          {props.task.result?.size ? <span>文件大小 {formatTaskSize(props.task.result.size)}</span> : null}
        </div>
      </div>
    </article>
  );
}

function TaskQueueStatCard(props: {
  label: string;
  value: number;
  highlight?: "accent" | "success" | "error";
}) {
  return (
    <article className={`md-card task-queue__stat${props.highlight ? ` task-queue__stat--${props.highlight}` : ""}`}>
      <span className="task-queue__stat-label">{props.label}</span>
      <strong className="task-queue__stat-value">{props.value}</strong>
    </article>
  );
}

function formatTaskDate(timestamp: number) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return String(timestamp);
  }
}

function formatTaskSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export { formatTaskDate, formatTaskSize };
