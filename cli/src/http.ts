import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export type HttpClientOptions = {
  origin: string;
  sessionId: string;
};

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly bodyText: string | null;

  constructor(message: string, options: { status: number; url: string; bodyText: string | null }) {
    super(message);
    this.name = "HttpError";
    this.status = options.status;
    this.url = options.url;
    this.bodyText = options.bodyText;
  }
}

export class HttpClient {
  private readonly origin: string;
  private readonly sessionId: string;

  constructor(options: HttpClientOptions) {
    this.origin = normalizeOrigin(options.origin);
    this.sessionId = options.sessionId;
  }

  getOrigin(): string {
    return this.origin;
  }

  async getJson<TSchema extends z.ZodTypeAny>(pathName: string, schema: TSchema): Promise<z.infer<TSchema>> {
    return this.requestJson(pathName, { method: "GET" }, schema);
  }

  async postJson<TBody extends unknown, TSchema extends z.ZodTypeAny>(
    pathName: string,
    body: TBody,
    schema: TSchema,
    options?: { expectedStatus?: number },
  ): Promise<z.infer<TSchema>> {
    return this.requestJson(
      pathName,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      schema,
      options,
    );
  }

  async requestJson<TSchema extends z.ZodTypeAny>(
    pathName: string,
    init: RequestInit,
    schema: TSchema,
    options?: { expectedStatus?: number },
  ): Promise<z.infer<TSchema>> {
    const url = this.buildUrl(pathName);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("x-jm-session", this.sessionId);

    const resp = await fetch(url, { ...init, headers });
    const expected = options?.expectedStatus;
    if (expected ? resp.status !== expected : !resp.ok) {
      const bodyText = await safeReadText(resp);
      throw new HttpError(`HTTP ${resp.status} ${resp.statusText}`, { status: resp.status, url, bodyText });
    }

    const json = (await resp.json()) as unknown;
    return schema.parse(json);
  }

  async downloadToDirectory(pathName: string, outDir: string, fileName: string): Promise<string> {
    const safeName = path.basename(fileName);
    const fullPath = path.resolve(outDir, safeName);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await this.downloadToFile(pathName, fullPath);
    return fullPath;
  }

  async downloadToFile(pathName: string, filePath: string): Promise<void> {
    const url = this.buildUrl(pathName);
    const headers = new Headers();
    headers.set("x-jm-session", this.sessionId);

    const resp = await fetch(url, { method: "GET", headers });
    if (!resp.ok) {
      const bodyText = await safeReadText(resp);
      throw new HttpError(`HTTP ${resp.status} ${resp.statusText}`, { status: resp.status, url, bodyText });
    }
    if (!resp.body) throw new Error("响应无 body，无法下载");

    const nodeReadable = Readable.fromWeb(resp.body as any);
    const out = createWriteStream(filePath);
    await pipeline(nodeReadable, out);
  }

  async fetchBinaryAbsolute(
    url: string,
    options?: { retries?: number; timeoutMs?: number },
  ): Promise<{ bytes: Uint8Array; contentType: string }> {
    const retries = options?.retries ?? 2;
    const timeoutMs = options?.timeoutMs ?? 30_000;

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const headers = new Headers();
          headers.set("x-jm-session", this.sessionId);
          const resp = await fetch(url, { method: "GET", headers, signal: controller.signal });
          if (!resp.ok) {
            const bodyText = await safeReadText(resp);
            throw new HttpError(`HTTP ${resp.status} ${resp.statusText}`, { status: resp.status, url, bodyText });
          }
          const bytes = new Uint8Array(await resp.arrayBuffer());
          const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
          return { bytes, contentType };
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        lastError = err;
        if (attempt <= retries) {
          await sleep(Math.min(2000, 300 * Math.pow(1.7, attempt - 1)));
          continue;
        }
        throw err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private buildUrl(pathName: string): string {
    const p = pathName.startsWith("/") ? pathName : `/${pathName}`;
    return `${this.origin}${p}`;
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

export async function pollTaskUntilFinished<TTask extends { status: string }>(options: {
  fetchTask: () => Promise<TTask>;
  isFinished: (task: TTask) => boolean;
  onTick?: (task: TTask, attempt: number) => void;
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
}): Promise<TTask> {
  const initialDelayMs = options.initialDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 2000;
  const maxAttempts = options.maxAttempts ?? 10_000;

  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const task = await options.fetchTask();
    options.onTick?.(task, attempt);
    if (options.isFinished(task)) return task;
    await sleep(delay);
    delay = Math.min(maxDelayMs, Math.floor(delay * 1.7));
  }
  throw new Error("轮询超时：任务长时间未结束");
}

function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  return trimmed.length ? trimmed : "http://127.0.0.1:8787";
}

async function safeReadText(resp: Response): Promise<string | null> {
  try {
    return await resp.text();
  } catch {
    return null;
  }
}
