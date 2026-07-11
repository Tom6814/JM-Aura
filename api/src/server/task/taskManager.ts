import { Semaphore } from "./semaphore";
import type { Task, TaskErrorInfo, TaskMetadata, TaskProgress, TaskResult, TaskStatus, TaskType } from "./types";

export type TaskRunner<TType extends TaskType = TaskType> = (ctx: TaskRunnerContext) => Promise<TaskResult<TType>>;

export interface TaskRetryPolicy {
  /**
   * Total attempts including the first run.
   */
  maxAttempts?: number;
  /**
   * Per-attempt timeout in milliseconds.
   */
  timeoutMs?: number;
}

export interface TaskExecutionOptions {
  retry?: TaskRetryPolicy;
}

export interface TaskLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface TaskRunnerContext {
  /**
   * Set the total number of ticks expected for this task.
   */
  setTotal(total: number): void;

  /**
   * Advance progress by 1. Optionally update the current label.
   */
  tick(label?: string): void;

  /**
   * Update the label displayed for the current progress step.
   */
  setCurrentLabel(label: string | null): void;

  /**
   * The latest label set by tick()/setCurrentLabel().
   */
  readonly currentLabel: string | null;

  /**
   * 1-based attempt index for the current execution.
   */
  readonly attempt: number;

  /**
   * Cooperative cancellation/timeout signal for the current attempt.
   */
  readonly signal: AbortSignal;

  /**
   * True once cancel(id) is requested.
   *
   * Runners should check this frequently and exit ASAP.
   */
  isCanceled(): boolean;
}

export interface TaskManagerOptions {
  concurrency: number;
  now?: () => number;
  logger?: TaskLogger;
}

class TaskCanceledError extends Error {
  override name = "TaskCanceledError";
}

class TaskAttemptTimeoutError extends Error {
  override name = "TaskAttemptTimeoutError";
}

type TaskInternal<TType extends TaskType = TaskType> = Task<TType> & {
  runner: TaskRunner<TType>;
  execution: TaskExecutionOptions;
  cancelRequested: boolean;
  runPromise?: Promise<Task<TType>>;
};

const defaultProgress = (): TaskProgress => ({ total: null, current: 0, currentLabel: null });

const DEFAULT_LOGGER: TaskLogger = {
  info(message, meta) {
    console.info(message, meta ?? {});
  },
  warn(message, meta) {
    console.warn(message, meta ?? {});
  },
  error(message, meta) {
    console.error(message, meta ?? {});
  },
};

export class TaskManager {
  private readonly sem: Semaphore;
  private readonly tasks = new Map<string, TaskInternal>();
  private readonly now: () => number;
  private readonly logger: TaskLogger;

  constructor(options: TaskManagerOptions) {
    this.sem = new Semaphore(options.concurrency);
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? DEFAULT_LOGGER;
  }

  create<TType extends TaskType>(
    type: TType,
    sessionId: string,
    runner: TaskRunner<TType>,
    execution?: TaskExecutionOptions,
    metadata?: TaskMetadata,
  ): Task<TType>;
  create<TType extends TaskType>(
    type: TType,
    runner: TaskRunner<TType>,
    execution?: TaskExecutionOptions,
    metadata?: TaskMetadata,
  ): Task<TType>;
  create<TType extends TaskType>(
    type: TType,
    sessionIdOrRunner: string | TaskRunner<TType>,
    runnerOrExecution?: TaskRunner<TType> | TaskExecutionOptions,
    executionOrMetadata?: TaskExecutionOptions | TaskMetadata,
    metadata?: TaskMetadata,
  ): Task<TType> {
    const { sessionId, runner, execution, taskMetadata } = this.resolveCreateParams(
      sessionIdOrRunner,
      runnerOrExecution,
      executionOrMetadata,
      metadata,
    );
    const id = crypto.randomUUID();
    const task: TaskInternal<TType> = {
      id,
      sessionId,
      type,
      status: "queued",
      createdAt: this.now(),
      metadata: taskMetadata,
      progress: defaultProgress(),
      runner,
      execution: normalizeExecutionOptions(execution),
      cancelRequested: false,
    };

    this.tasks.set(id, task);
    return this.snapshot(task);
  }

  list(options: { limit?: number } = {}): Task[] {
    return this.listSnapshots(() => true, options);
  }

  listBySession(sessionId: string, options: { limit?: number } = {}): Task[] {
    return this.listSnapshots((task) => task.sessionId === sessionId, options);
  }

  get<TType extends TaskType = TaskType>(id: string): Task<TType> | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    return this.snapshot(task as TaskInternal<TType>);
  }

  getOwnedTask<TType extends TaskType = TaskType>(sessionId: string, id: string): Task<TType> | undefined {
    const task = this.tasks.get(id);
    if (!task || task.sessionId !== sessionId) return undefined;
    return this.snapshot(task as TaskInternal<TType>);
  }

  deleteOwnedTask(sessionId: string, id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.sessionId !== sessionId) return false;
    return this.tasks.delete(id);
  }

  deleteBySession(sessionId: string): number {
    let deletedCount = 0;
    for (const [id, task] of this.tasks.entries()) {
      if (task.sessionId !== sessionId) continue;
      if (this.tasks.delete(id)) {
        deletedCount += 1;
      }
    }
    return deletedCount;
  }

  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;

    task.cancelRequested = true;

    // If it hasn't started yet, we can mark it canceled immediately.
    if (task.status === "queued") {
      task.status = "canceled";
      task.finishedAt = this.now();
    }
  }

  /**
   * Run a task.
   *
   * - Concurrency is globally limited per TaskManager instance.
   * - On cancel, this promise rejects (TaskCanceledError).
   */
  async run<TType extends TaskType = TaskType>(id: string): Promise<Task<TType>> {
    const task = this.tasks.get(id) as TaskInternal<TType> | undefined;
    if (!task) throw new Error(`Task not found: ${id}`);

    if (task.runPromise) return task.runPromise;

    task.runPromise = this.sem.run(async () => {
      // If it was canceled while queued (either before run() is called or while
      // waiting for the semaphore), do not start.
      if (task.status === "canceled" || task.cancelRequested) {
        task.status = "canceled";
        task.finishedAt = task.finishedAt ?? this.now();
        throw new TaskCanceledError("task canceled before start");
      }

      task.status = "running";
      task.startedAt = this.now();
      this.logger.info("task started", {
        taskId: task.id,
        taskType: task.type,
      });

      try {
        const maxAttempts = task.execution.retry?.maxAttempts ?? 1;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          task.progress = defaultProgress();
          const attemptController = new AbortController();
          const ctx = new TaskRunnerContextImpl(task, attempt, attemptController.signal);

          try {
            const result = await runTaskAttemptWithTimeout(task, ctx, attemptController);

            // Runner might not throw; still respect cancellation.
            if (ctx.isCanceled()) {
              task.status = "canceled";
              task.finishedAt = this.now();
              throw new TaskCanceledError("task canceled");
            }

            task.status = "succeeded";
            task.result = result;
            task.finishedAt = this.now();
            this.logger.info("task finished", {
              taskId: task.id,
              taskType: task.type,
              durationMs: task.finishedAt - task.createdAt,
              attempts: attempt,
            });
            return this.snapshot(task);
          } catch (err) {
            if (err instanceof TaskCanceledError || ctx.isCanceled()) {
              task.status = "canceled";
              task.finishedAt = this.now();
              // Keep error empty for canceled tasks.
              delete task.error;
              this.logger.warn("task canceled", {
                taskId: task.id,
                taskType: task.type,
                durationMs: task.finishedAt - task.createdAt,
                attempts: attempt,
              });
              throw err;
            }

            lastError = err;
            if (attempt < maxAttempts && isRetryableTaskError(err)) {
              this.logger.warn("task retry scheduled", {
                taskId: task.id,
                taskType: task.type,
                attempt,
                maxAttempts,
                reason: getErrorMessage(err),
              });
              continue;
            }

            throw err;
          }
        }

        throw lastError;
      } catch (err) {
        task.status = "failed";
        task.error = toErrorInfo(err);
        task.finishedAt = this.now();
        this.logger.error("task failed", {
          taskId: task.id,
          taskType: task.type,
          durationMs: task.finishedAt - task.createdAt,
          error: task.error.message,
        });
        throw err;
      }
    });

    return task.runPromise;
  }

  private snapshot<TType extends TaskType>(task: TaskInternal<TType>): Task<TType> {
    // Return a fresh object to prevent external mutation.
    return {
      id: task.id,
      sessionId: task.sessionId,
      type: task.type,
      status: task.status as TaskStatus,
      createdAt: task.createdAt,
      metadata: task.metadata ? { ...task.metadata } : undefined,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      progress: { ...task.progress },
      result: task.result as TaskResult<TType> | undefined,
      error: task.error,
    };
  }

  private resolveCreateParams<TType extends TaskType>(
    sessionIdOrRunner: string | TaskRunner<TType>,
    runnerOrExecution?: TaskRunner<TType> | TaskExecutionOptions,
    executionOrMetadata?: TaskExecutionOptions | TaskMetadata,
    metadata?: TaskMetadata,
  ): {
    sessionId: string;
    runner: TaskRunner<TType>;
    execution?: TaskExecutionOptions;
    taskMetadata?: TaskMetadata;
  } {
    if (typeof sessionIdOrRunner === "string") {
      if (typeof runnerOrExecution !== "function") {
        throw new TypeError("TaskManager.create requires a task runner");
      }
      return {
        sessionId: sessionIdOrRunner,
        runner: runnerOrExecution,
        execution: executionOrMetadata as TaskExecutionOptions | undefined,
        taskMetadata: metadata,
      };
    }

    return {
      sessionId: "",
      runner: sessionIdOrRunner,
      execution: runnerOrExecution as TaskExecutionOptions | undefined,
      taskMetadata: executionOrMetadata as TaskMetadata | undefined,
    };
  }

  private listSnapshots(
    predicate: (task: TaskInternal) => boolean,
    options: { limit?: number } = {},
  ): Task[] {
    const tasks = [...this.tasks.values()].filter(predicate).sort((a, b) => b.createdAt - a.createdAt);
    const limit = options.limit;
    const sliced = typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? tasks.slice(0, Math.floor(limit)) : tasks;
    return sliced.map((task) => this.snapshot(task));
  }
}

class TaskRunnerContextImpl implements TaskRunnerContext {
  constructor(
    private readonly task: TaskInternal,
    readonly attempt: number,
    readonly signal: AbortSignal,
  ) {}

  setTotal(total: number): void {
    if (!Number.isFinite(total) || total < 0) return;
    this.task.progress.total = Math.floor(total);
  }

  tick(label?: string): void {
    this.task.progress.current += 1;
    if (typeof label === "string") {
      this.task.progress.currentLabel = label;
    }
  }

  setCurrentLabel(label: string | null): void {
    this.task.progress.currentLabel = label;
  }

  get currentLabel(): string | null {
    return this.task.progress.currentLabel;
  }

  isCanceled(): boolean {
    return this.task.cancelRequested;
  }
}

function toErrorInfo(err: unknown): TaskErrorInfo {
  if (err instanceof Error) {
    const info: TaskErrorInfo = { message: err.message };
    if (typeof err.stack === "string") info.stack = err.stack;
    return info;
  }

  return { message: String(err) };
}

function normalizeExecutionOptions(options?: TaskExecutionOptions): TaskExecutionOptions {
  const maxAttempts = Math.max(1, Math.floor(options?.retry?.maxAttempts ?? 1));
  const timeoutMs =
    typeof options?.retry?.timeoutMs === "number" && Number.isFinite(options.retry.timeoutMs) && options.retry.timeoutMs > 0
      ? Math.floor(options.retry.timeoutMs)
      : undefined;

  return {
    retry: {
      maxAttempts,
      timeoutMs,
    },
  };
}

async function runTaskAttemptWithTimeout<TType extends TaskType>(
  task: TaskInternal<TType>,
  ctx: TaskRunnerContextImpl,
  attemptController: AbortController,
): Promise<TaskResult<TType>> {
  const timeoutMs = task.execution.retry?.timeoutMs;
  if (!timeoutMs) {
    return task.runner(ctx);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.runner(ctx),
      new Promise<TaskResult<TType>>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new TaskAttemptTimeoutError(
            `Task ${task.id} attempt ${ctx.attempt} timed out after ${timeoutMs}ms`,
          );
          attemptController.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isRetryableTaskError(err: unknown): boolean {
  const status = getNumericProperty(err, "status");
  if (status === 401 || status === 403) return false;
  if (typeof status === "number" && status >= 500) return true;

  const code = getStringProperty(err, "code")?.toUpperCase();
  if (code && NON_RETRYABLE_AUTH_CODES.has(code)) return false;
  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;

  const name = getStringProperty(err, "name") ?? "";
  if (NON_RETRYABLE_AUTH_PATTERN.test(name)) return false;
  if (RETRYABLE_ERROR_PATTERN.test(name)) return true;

  const message = getErrorMessage(err);
  if (NON_RETRYABLE_AUTH_PATTERN.test(message)) return false;
  return RETRYABLE_ERROR_PATTERN.test(message);
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getStringProperty(err: unknown, key: string): string | undefined {
  if (typeof err !== "object" || err === null || !(key in err)) return undefined;
  const value = (err as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function getNumericProperty(err: unknown, key: string): number | undefined {
  if (typeof err !== "object" || err === null || !(key in err)) return undefined;
  const value = (err as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const NON_RETRYABLE_AUTH_CODES = new Set(["EAUTH", "UNAUTHORIZED", "FORBIDDEN"]);
const NON_RETRYABLE_AUTH_PATTERN = /\b(auth|unauthori[sz]ed|forbidden|鉴权|认证|未登录|登录失效|permission)\b/i;
const RETRYABLE_ERROR_PATTERN = /\b(network|fetch failed|timeout|timed out|export|zip|stream|write|socket|connection|temporary)\b/i;
