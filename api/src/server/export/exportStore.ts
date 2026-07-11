import fs from "node:fs/promises";
import path from "node:path";

export interface ExportStoreOptions {
  /**
   * Root directory for temporary export artifacts (zip).
   *
   * Default: `.cache/exports`
   */
  rootDir?: string;
  /**
   * TTL for artifacts.
   *
   * Default: 2 hours.
   */
  ttlMs?: number;
  /**
   * Lazy cleanup cadence.
   *
   * Default: 5 minutes.
   */
  cleanupIntervalMs?: number;
  now?: () => number;
}

export class ExportStore {
  readonly rootDir: string;
  readonly ttlMs: number;
  readonly cleanupIntervalMs: number;
  private readonly now: () => number;
  private nextCleanupAt = 0;
  private cleanupPromise?: Promise<number>;

  constructor(options?: ExportStoreOptions) {
    this.rootDir = options?.rootDir ?? ".cache/exports";
    this.ttlMs = options?.ttlMs ?? 2 * 60 * 60 * 1000;
    this.cleanupIntervalMs = Math.max(1, Math.floor(options?.cleanupIntervalMs ?? 5 * 60 * 1000));
    this.now = options?.now ?? (() => Date.now());
  }

  async ensureRootDir(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  getZipPath(taskId: string): string {
    return path.join(this.rootDir, `${taskId}.zip`);
  }

  async deleteZipIfExists(filePath: string): Promise<boolean> {
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err: unknown) {
      if (isErrno(err, "ENOENT")) return false;
      throw err;
    }
  }

  /**
   * A "download friendly" filename for the generated zip.
   * - Without hint: `<taskId>.zip`
   * - With hint: `<sanitizedHint>-<taskId>.zip`
   */
  getZipFileName(taskId: string, hint?: string): string {
    const safeHint = sanitizeFileName(hint);
    if (safeHint) return `${safeHint}-${taskId}.zip`;
    return `${taskId}.zip`;
  }

  /**
   * Whether a file with mtime should be considered expired.
   *
   * Expired when: now >= mtime + ttl
   */
  isExpired(mtimeMs: number, nowMs: number = Date.now()): boolean {
    return nowMs >= mtimeMs + this.ttlMs;
  }

  /**
   * Scan rootDir and delete expired `*.zip` files.
   *
   * Returns: number of deleted files.
   */
  async cleanupOnce(nowMs: number = Date.now()): Promise<number> {
    let dirents: Array<import("node:fs").Dirent>;
    try {
      dirents = await fs.readdir(this.rootDir, { withFileTypes: true });
    } catch (err: unknown) {
      // rootDir does not exist yet.
      if (isErrno(err, "ENOENT")) return 0;
      throw err;
    }

    let deleted = 0;
    await Promise.all(
      dirents.map(async (d) => {
        if (!d.isFile()) return;
        if (!d.name.endsWith(".zip")) return;
        const filePath = path.join(this.rootDir, d.name);
        try {
          const st = await fs.stat(filePath);
          if (!this.isExpired(st.mtimeMs, nowMs)) return;
          await fs.unlink(filePath);
          deleted += 1;
        } catch (err: unknown) {
          // Racy conditions: file removed / permission issues.
          if (isErrno(err, "ENOENT")) return;
          // For best-effort cleanup, ignore unlink/stat errors except non-trivial ones.
        }
      }),
    );

    return deleted;
  }

  async cleanupIfDue(nowMs: number = this.now()): Promise<number> {
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }

    if (nowMs < this.nextCleanupAt) {
      return 0;
    }

    this.nextCleanupAt = nowMs + this.cleanupIntervalMs;
    this.cleanupPromise = this.cleanupOnce(nowMs)
      .catch((err) => {
        this.nextCleanupAt = nowMs;
        throw err;
      })
      .finally(() => {
        this.cleanupPromise = undefined;
      });
    return this.cleanupPromise;
  }
}

function sanitizeFileName(input?: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Remove characters that are invalid on common filesystems and HTTP header contexts.
  // Also strip control chars.
  const noCtl = trimmed.replace(/[\u0000-\u001f\u007f]/g, "");
  const replaced = noCtl
    .replace(/[\/\\?%*:|"<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!replaced) return "";

  // Keep it short-ish.
  const maxLen = 80;
  const sliced = replaced.length > maxLen ? replaced.slice(0, maxLen).trim() : replaced;
  return sliced.replace(/\s+/g, "_");
}

function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as any).code === code
  );
}
