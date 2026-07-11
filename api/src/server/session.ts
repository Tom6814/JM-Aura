import { JMComicClient } from "./jmClient";

export interface SessionContext {
  sessionId: string;
  isNew: boolean;
  client: JMComicClient;
}

export const AURA_SESSION_COOKIE_NAME = "aura_session";
export const DEFAULT_DEVICE_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

export function buildDeviceSessionCookieHeaderValue(sessionId: string) {
  return `${AURA_SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
}

/**
 * In-memory session manager for isolating JMComicClient instances (cookie jars).
 *
 * Session id来源优先级：
 *  1) `x-jm-session` header（用于 CLI / API 调用显式隔离）
 *  2) `aura_session` cookie（用于 Web 设备级 session）
 *  3) 若都没有，则生成新 id
 *
 * 特性：
 * - 设备级 session（cookie）会在闲置超过 TTL 后失效，随后会分配新 session id
 * - header session（x-jm-session）用于显式隔离，不会因为 TTL 改变 session id
 * - 仅内存 Map，不做持久化
 */
export class JmSessionManager {
  private readonly sessions = new Map<string, { client: JMComicClient; lastAccessAtMs: number }>();
  private readonly createClientFn: () => JMComicClient;
  private readonly ttlMs: number;
  private readonly nowMs: () => number;
  private readonly onSessionExpired?: (sessionId: string) => Promise<void> | void;

  constructor(options?: {
    createClient?: () => JMComicClient;
    ttlMs?: number;
    nowMs?: () => number;
    onSessionExpired?: (sessionId: string) => Promise<void> | void;
  }) {
    this.createClientFn = options?.createClient ?? (() => new JMComicClient());
    this.ttlMs = options?.ttlMs ?? DEFAULT_DEVICE_SESSION_TTL_MS;
    this.nowMs = options?.nowMs ?? (() => Date.now());
    this.onSessionExpired = options?.onSessionExpired;
  }

  get(request: Request): SessionContext {
    const headerId = request.headers.get("x-jm-session")?.trim();
    const cookieId = readCookie(request.headers.get("cookie"), AURA_SESSION_COOKIE_NAME);
    const hasHeader = headerId && headerId.length > 0;
    const source: "header" | "cookie" | "none" = hasHeader ? "header" : cookieId ? "cookie" : "none";
    let sessionId = (hasHeader ? headerId : cookieId) ?? crypto.randomUUID();

    const now = this.nowMs();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      const expired = source !== "header" && now - existing.lastAccessAtMs > this.ttlMs;
      if (!expired) {
        existing.lastAccessAtMs = now;
        return { sessionId, isNew: false, client: existing.client };
      }

      // Expired: drop old session and create a new one.
      this.sessions.delete(sessionId);
      if (source === "cookie") {
        const cleanup = this.onSessionExpired?.(sessionId);
        if (isPromiseLike(cleanup)) {
          void cleanup.catch(() => null);
        }
        sessionId = crypto.randomUUID();
      }
    }

    const client = this.createClientFn();
    this.sessions.set(sessionId, { client, lastAccessAtMs: now });
    return { sessionId, isNew: true, client };
  }

  /** Replace the JMComicClient instance for a session id (session itself is preserved). */
  resetClient(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    this.sessions.set(sessionId, { client: this.createClientFn(), lastAccessAtMs: this.nowMs() });
  }
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/g);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    const v = part.slice(eq + 1).trim();
    return v.length ? v : null;
  }
  return null;
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
