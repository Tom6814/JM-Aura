import { z } from "zod";
import { hc } from "hono/client";

import type { AppType } from "../../../api/src/server/index";
import { getHomeStreamCacheKey } from "./home-stream";
import { readThroughServerCache } from "./server-cache";
import {
  chapterSchema,
  mangaSchema,
  searchResultSchema,
  categoryResultSchema,
  homeFeedSchema,
  favoritesResultSchema,
  profileResultSchema,
  loginResultSchema,
  commentsResultSchema,
  ORDER_BY_VALUES,
  TIME_VALUES,
  CATEGORY_VALUES,
  type Chapter,
  type Image,
  type Manga,
  type SearchResult,
  type SearchResultItem,
  type CategoryResult,
  type HomeFeed,
  type FavoritesResult,
  type ProfileResult,
  type LoginResult,
  type CommentsResult,
  type OrderBy,
  type TimeRange,
  type Category,
} from "../../../packages/shared/src/schema";

// ─── Input types ──────────────────────────────────────────────────────────────

export interface SearchMangaInput {
  keyword: string;
  page?: number;
  /** Search scope: 0=site, 1=works, 2=author, 3=tag, 4=actor. Default: 0 */
  main_tag?: 0 | 1 | 2 | 3 | 4;
  /** Sort order. Default: "mr" (most recent) */
  order_by?: OrderBy;
  /** Time range. Default: "a" (all time) */
  time?: TimeRange;
}

export interface FetchCategoriesInput {
  page?: number;
  category?: Category;
  sub_category?: string;
  order_by?: OrderBy;
  time?: TimeRange;
}

export interface FetchFavoritesInput {
  page?: number;
  /** Folder ID — "0" = all folders. Default: "0" */
  folder_id?: string;
  order_by?: OrderBy;
  /** Page size used by our backend adapter. Default: 20. */
  page_size?: number;
}

export interface CreateFavoritesExportTaskInput {
  folderId?: string;
  orderBy?: OrderBy;
  imageFormat?: "original" | "webp" | "jpeg";
  concurrency?: number;
}

export interface CreateAlbumExportTaskInput {
  albumId: string;
  chapterIds?: string[];
  selectedChapters?: Array<{
    chapterId: string;
    chapterTitle?: string | null;
    chapterSort?: string | null;
  }>;
  imageFormat?: "original" | "webp" | "jpeg";
  concurrency?: number;
}

export interface LoginUserResult {
  user: LoginResult;
  sessionCookie: string | null;
}

export interface LogoutUserResult {
  success: boolean;
  sessionCookie: string | null;
}

const HOME_SECTION_CACHE_TTL_MS = 15_000;
const HOME_FEED_CACHE_TTL_MS = HOME_SECTION_CACHE_TTL_MS;
const CATEGORY_FEED_CACHE_TTL_MS = 15_000;

const taskProgressSchema = z
  .object({
    total: z.number().int().nonnegative().nullable(),
    current: z.number().int().nonnegative(),
    currentLabel: z.string().nullable(),
  })
  .strict();

const taskResultSchema = z
  .object({
    filePath: z.string(),
    fileName: z.string(),
    size: z.number().int().nonnegative(),
  })
  .strict();

const taskMetadataSchema = z
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

const taskErrorSchema = z
  .object({
    message: z.string(),
    stack: z.string().optional(),
  })
  .strict();

const logoutResultSchema = z
  .object({
    success: z.boolean(),
  })
  .strict();

const deleteTaskResultSchema = z
  .object({
    ok: z.literal(true),
    deletedTaskId: z.string().min(1),
  })
  .strict();

export const taskSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["export_album_zip", "export_favorites_zip"]),
    status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
    createdAt: z.number().int().nonnegative(),
    metadata: taskMetadataSchema.optional(),
    startedAt: z.number().int().nonnegative().optional(),
    finishedAt: z.number().int().nonnegative().optional(),
    progress: taskProgressSchema,
    result: taskResultSchema.optional(),
    error: taskErrorSchema.optional(),
  })
  .strict();

export type TaskSummary = z.infer<typeof taskSchema>;

// ─── Origin resolution ────────────────────────────────────────────────────────

export function getApiOrigin(request: Request): string {
  const apiOriginFromEnv = readOriginEnv("API_ORIGIN");
  if (apiOriginFromEnv) {
    return apiOriginFromEnv;
  }

  const legacyServerOrigin = readOriginEnv("JM_SERVER_ORIGIN");
  if (legacyServerOrigin) {
    return legacyServerOrigin;
  }

  const requestUrl = new URL(request.url);
  const isLocalHost =
    requestUrl.hostname === "127.0.0.1" ||
    requestUrl.hostname === "localhost";
  const isSeparateFrontendPort =
    requestUrl.port === "3000" || requestUrl.port === "5173" || requestUrl.port === "52668";

  // 本地开发/预览时，Remix 常跑在 3000/5173/随机端口，而 Hono API 固定在 8787。
  // 这里不依赖 NODE_ENV，因为本地预览时它可能为空。
  if ((process.env.NODE_ENV === "development" || (isLocalHost && isSeparateFrontendPort)) && requestUrl.port !== "8787") {
    return "http://127.0.0.1:8787";
  }

  return requestUrl.origin;
}

function readOriginEnv(name: "API_ORIGIN" | "JM_SERVER_ORIGIN"): string | null {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return null;
  }

  return rawValue.replace(/\/+$/, "");
}

export function createJmRpcClient(request: Request) {
  return hc<AppType>(getApiOrigin(request)) as JmRpcClient;
}

// ─── RPC methods ──────────────────────────────────────────────────────────────

/** Fetch manga (album) detail by JM ID. */
export async function fetchManga(request: Request, id: string): Promise<Manga> {
  const client = createJmRpcClient(request);
  const response = await client.api.manga[":id"].$get({
    param: { id },
  });

  return parseRpcResponse(response, mangaSchema, "获取漫画详情失败");
}

/** Fetch chapter (photo) detail by JM ID. */
export async function fetchChapter(request: Request, id: string): Promise<Chapter> {
  const client = createJmRpcClient(request);
  const response = await client.api.chapter[":id"].$get({
    param: { id },
  });

  return parseRpcResponse(response, chapterSchema, "获取章节详情失败");
}

/** Search manga with optional scope, sort, and time filters. */
export async function searchManga(request: Request, input: SearchMangaInput): Promise<SearchResult> {
  const client = createJmRpcClient(request);
  const response = await client.api.search.$post({
    json: {
      keyword: input.keyword,
      page: input.page ?? 1,
      main_tag: input.main_tag ?? 0,
      order_by: input.order_by ?? "mr",
      time: input.time ?? "a",
    },
  });

  return parseRpcResponse(response, searchResultSchema, "搜索漫画失败");
}

/** Fetch category / ranking page. Mirrors Python categories_filter. */
export async function fetchCategories(request: Request, input: FetchCategoriesInput = {}): Promise<CategoryResult> {
  const apiOrigin = getApiOrigin(request);
  const category = CATEGORY_VALUES.includes((input.category ?? "") as Category) ? (input.category ?? "") : "";
  const orderBy = ORDER_BY_VALUES.includes((input.order_by ?? "mv") as OrderBy) ? (input.order_by ?? "mv") : "mv";
  const time = TIME_VALUES.includes((input.time ?? "a") as TimeRange) ? (input.time ?? "a") : "a";
  const page = Number.isFinite(input.page) && (input.page ?? 0) > 0 ? Math.trunc(input.page ?? 1) : 1;
  const subCategory = typeof input.sub_category === "string" && input.sub_category.trim().length > 0 ? input.sub_category.trim() : undefined;
  const cacheKey = [
    "categories",
    apiOrigin,
    category,
    subCategory ?? "",
    orderBy,
    time,
    page,
  ].join(":");

  return readThroughServerCache(cacheKey, CATEGORY_FEED_CACHE_TTL_MS, async () => {
    const response = await fetch(`${apiOrigin}/api/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page,
        category,
        sub_category: subCategory,
        order_by: orderBy,
        time,
      }),
    });

    return parseRpcResponse(response, categoryResultSchema, "获取分类列表失败");
  });
}

/** Fetch the first-screen home aggregate. */
export async function fetchHomeFeed(request: Request, category: Category = ""): Promise<HomeFeed> {
  const apiOrigin = getApiOrigin(request);
  const cacheKey = ["home", apiOrigin, category].join(":");

  return readThroughServerCache(cacheKey, HOME_FEED_CACHE_TTL_MS, async () => {
    const response = await fetch(`${apiOrigin}/api/home?category=${encodeURIComponent(category)}`);
    return parseRpcResponse(response, homeFeedSchema, "获取首页聚合数据失败");
  });
}

export async function fetchHomeLatest(
  request: Request,
  category: Category = "",
): Promise<SearchResultItem[]> {
  const apiOrigin = getApiOrigin(request);
  const cacheKey = [
    apiOrigin,
    getHomeStreamCacheKey("latest", category),
  ].join(":");

  return readThroughServerCache(cacheKey, HOME_SECTION_CACHE_TTL_MS, async () => {
    const response = await fetch(`${apiOrigin}/api/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: 1,
        category,
        order_by: "mr",
        time: "a",
      }),
    });

    const result = await parseRpcResponse(
      response,
      categoryResultSchema,
      "获取首页最新更新失败",
    );
    return result.content;
  });
}

/** Fetch monthly ranking page. */
export async function fetchRankingsMonth(request: Request, page = 1, category: Category = ""): Promise<CategoryResult> {
  const apiOrigin = getApiOrigin(request);
  const cacheKey = [
    apiOrigin,
    getHomeStreamCacheKey("ranking-month", category),
    page,
  ].join(":");

  return readThroughServerCache(cacheKey, HOME_SECTION_CACHE_TTL_MS, async () => {
    const url = `${apiOrigin}/api/rankings/month?page=${page}&category=${encodeURIComponent(category)}`;
    const response = await fetch(url);
    return parseRpcResponse(response, categoryResultSchema, "获取月排行失败");
  });
}

/** Fetch weekly ranking page. */
export async function fetchRankingsWeek(request: Request, page = 1, category: Category = ""): Promise<CategoryResult> {
  const apiOrigin = getApiOrigin(request);
  const cacheKey = [
    apiOrigin,
    getHomeStreamCacheKey("ranking-week", category),
    page,
  ].join(":");

  return readThroughServerCache(cacheKey, HOME_SECTION_CACHE_TTL_MS, async () => {
    const url = `${apiOrigin}/api/rankings/week?page=${page}&category=${encodeURIComponent(category)}`;
    const response = await fetch(url);
    return parseRpcResponse(response, categoryResultSchema, "获取周排行失败");
  });
}

/** Fetch daily ranking page. */
export async function fetchRankingsToday(
  request: Request,
  page = 1,
  category: Category = "",
): Promise<CategoryResult> {
  const apiOrigin = getApiOrigin(request);
  const cacheKey = [
    apiOrigin,
    getHomeStreamCacheKey("ranking-today", category),
    page,
  ].join(":");

  return readThroughServerCache(cacheKey, HOME_SECTION_CACHE_TTL_MS, async () => {
    const url = `${apiOrigin}/api/rankings/today?page=${page}&category=${encodeURIComponent(category)}`;
    const response = await fetch(url);
    return parseRpcResponse(response, categoryResultSchema, "获取日排行失败");
  });
}

/** Login with username + password. Returns user info plus backend session cookie. */
export async function loginUser(
  request: Request,
  username: string,
  password: string,
): Promise<LoginUserResult> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/auth/login`, {
    method: "POST",
    headers: createForwardHeaders(request, { "Content-Type": "application/json" }),
    body: JSON.stringify({ username, password }),
  });

  const sessionCookie = response.headers.get("Set-Cookie");
  return {
    user: await parseRpcResponse(response, loginResultSchema, "登录失败"),
    sessionCookie,
  };
}

/** Logout from JM (clears JM cookie jar) but keeps device session. */
export async function logoutUser(request: Request): Promise<LogoutUserResult> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/logout`, {
    method: "POST",
    headers: createForwardHeaders(request),
  });

  return {
    ...(await parseRpcResponse(response, logoutResultSchema, "登出失败")),
    sessionCookie: response.headers.get("Set-Cookie"),
  };
}

/** Fetch the user's favorites list. Requires prior login. */
export async function fetchFavorites(request: Request, input: FetchFavoritesInput = {}): Promise<FavoritesResult> {
  const apiOrigin = getApiOrigin(request);
  const params = new URLSearchParams({
    page: String(input.page ?? 1),
    folder_id: input.folder_id ?? "0",
    order_by: input.order_by ?? "mr",
  });
  if (input.page_size) {
    params.set("page_size", String(input.page_size));
  }

  const response = await fetch(`${apiOrigin}/api/favorites?${params.toString()}`, {
    headers: createForwardHeaders(request),
  });
  return parseRpcResponse(response, favoritesResultSchema, "获取收藏夹失败");
}

/** Fetch the user's profile summary. Requires prior login. */
export async function fetchProfile(request: Request): Promise<ProfileResult> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/profile`, {
    headers: createForwardHeaders(request),
  });
  return parseRpcResponse(response, profileResultSchema, "获取用户资料失败");
}

/** Fetch export/download tasks. */
export async function fetchTaskList(request: Request): Promise<TaskSummary[]> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/tasks`, {
    headers: createForwardHeaders(request),
  });
  return parseRpcResponse(response, z.array(taskSchema), "获取任务列表失败");
}

/** Delete a completed/failed task owned by the current session. */
export async function deleteTask(
  request: Request,
  id: string,
): Promise<{ ok: true; deletedTaskId: string }> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: createForwardHeaders(request),
  });

  return parseRpcResponse(response, deleteTaskResultSchema, "删除下载任务失败");
}

export async function fetchComments(
  request: Request,
  albumId: string,
  input: { page?: number; order?: "asc" | "desc" } = {},
): Promise<CommentsResult> {
  const apiOrigin = getApiOrigin(request);
  const params = new URLSearchParams({
    album_id: albumId,
    page: String(input.page ?? 1),
    order: input.order ?? "asc",
  });
  const response = await fetch(`${apiOrigin}/api/comments?${params.toString()}`, {
    headers: createForwardHeaders(request),
  });
  return parseRpcResponse(response, commentsResultSchema, "获取评论失败");
}

/** Create a favorites export task and start it immediately. */
export async function createFavoritesExportTask(
  request: Request,
  input: CreateFavoritesExportTaskInput = {},
): Promise<TaskSummary> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/tasks/export/favorites`, {
    method: "POST",
    headers: createForwardHeaders(request, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      folderId: input.folderId ?? "0",
      orderBy: input.orderBy ?? "mr",
      imageFormat: input.imageFormat ?? "webp",
      concurrency: input.concurrency,
    }),
  });

  return parseRpcResponse(response, taskSchema, "创建收藏夹导出任务失败");
}

/** Create an album export task and optionally limit it to selected chapters. */
export async function createAlbumExportTask(
  request: Request,
  input: CreateAlbumExportTaskInput,
): Promise<TaskSummary> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/tasks/export/album`, {
    method: "POST",
    headers: createForwardHeaders(request, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      albumId: input.albumId,
      chapterIds: input.chapterIds,
      selectedChapters: input.selectedChapters,
      imageFormat: input.imageFormat ?? "webp",
      concurrency: input.concurrency,
    }),
  });

  return parseRpcResponse(response, taskSchema, "创建作品导出任务失败");
}

/** Add a manga to favorites. Requires prior login. */
export async function addFavorite(
  request: Request,
  album_id: string,
  folder_id = "0",
): Promise<{ success: boolean; album_id: string }> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/favorites`, {
    method: "POST",
    headers: createForwardHeaders(request, { "Content-Type": "application/json" }),
    body: JSON.stringify({ album_id, folder_id }),
  });

  if (!response.ok) {
    const payload = (await response.json()) as unknown;
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && typeof (payload as Record<string, unknown>).error === "string"
        ? (payload as Record<string, string>).error
        : `添加收藏失败，HTTP ${response.status}`;
    throw new Error(message);
  }

  return (await response.json()) as { success: boolean; album_id: string };
}

function createForwardHeaders(
  request: Request,
  init?: HeadersInit,
): Headers {
  const headers = new Headers(init);
  const cookie = request.headers.get("Cookie");
  const userAgent = request.headers.get("User-Agent");

  if (cookie) {
    headers.set("Cookie", cookie);
  }

  if (userAgent && !headers.has("User-Agent")) {
    headers.set("User-Agent", userAgent);
  }

  return headers;
}

// ─── Image URL builders ───────────────────────────────────────────────────────

/** Build the proxied + decrypted image URL for a chapter image. */
export function buildImageProxyUrl(apiOrigin: string, image: Image, format: "jpeg" | "webp" = "webp"): string {
  const params = new URLSearchParams({
    url: image.download_url,
    scramble_id: image.scramble_id,
    aid: image.aid,
    img_file_name: image.img_file_name,
    decrypt: "true",
    format,
  });

  return `${apiOrigin}/api/image/proxy?${params.toString()}`;
}

/** Build a passthrough (no decryption) proxied image URL. */
export function buildPassthroughImageUrl(apiOrigin: string, url: string, format: "jpeg" | "webp" = "webp"): string {
  const params = new URLSearchParams({
    url,
    decrypt: "false",
    format,
  });

  return `${apiOrigin}/api/image/proxy?${params.toString()}`;
}

/**
 * Build the manga cover URL through our cover proxy.
 * `size` can be "" (full resolution) or "_3x4" (thumbnail used in search results).
 */
export function buildCoverUrl(
  apiOrigin: string,
  albumId: string,
  size: "" | "_3x4" = "",
  format: "jpeg" | "webp" = "webp",
): string {
  const params = new URLSearchParams({ size, format });
  return `${apiOrigin}/api/cover/${albumId}?${params.toString()}`;
}

/** Build a same-origin task download path for completed exports. */
export function buildTaskDownloadPath(taskId: string): string {
  return `/api/tasks/${encodeURIComponent(taskId)}/download`;
}

// ─── Internal: response parser ────────────────────────────────────────────────

async function parseRpcResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  errorPrefix: string,
): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && typeof (payload as Record<string, unknown>).error === "string"
        ? (payload as Record<string, string>).error
        : `${errorPrefix}，HTTP ${response.status}`;
    throw new Error(message);
  }

  return schema.parse(payload);
}

// ─── Internal: Hono RPC client type shim ─────────────────────────────────────
// (Hono's hc<AppType> is typed at build-time; this manual shim ensures the
// runtime client can be cast without ts errors in the Remix loader context.)

type JmRpcClient = {
  api: {
    manga: {
      ":id": {
        $get(args: { param: { id: string } }): Promise<Response>;
      };
    };
    chapter: {
      ":id": {
        $get(args: { param: { id: string } }): Promise<Response>;
      };
    };
    search: {
      $post(args: {
        json: {
          keyword: string;
          page: number;
          main_tag: number;
          order_by: string;
          time: string;
        };
      }): Promise<Response>;
    };
  };
};

// Re-export schema constants for convenience
export { ORDER_BY_VALUES, TIME_VALUES, CATEGORY_VALUES };
export type { OrderBy, TimeRange, Category };
