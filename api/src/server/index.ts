import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { JMComicClient, type JmImageEncodeResult } from "./jmClient";
import { buildDeviceSessionCookieHeaderValue, JmSessionManager } from "./session";
import { ExportStore } from "./export/exportStore";
import { fetchAlbumManifest } from "./export/manifest";
import { createTasksRouter } from "./routes/tasks";
import { TaskManager } from "./task/taskManager";
import {
  chapterSchema,
  imageSchema,
  mangaSchema,
  searchResultItemSchema,
  searchResultSchema,
  categoryResultSchema,
  homeFeedSchema,
  favoritesResultSchema,
  favoriteItemSchema,
  favoriteFolderSchema,
  loginResultSchema,
  profileResultSchema,
  profileSchema,
  commentItemSchema,
  commentsResultSchema,
  ORDER_BY_VALUES,
  TIME_VALUES,
  CATEGORY_VALUES,
} from "../../../packages/shared/src/schema";

const DEFAULT_AUTHOR = "default_author";
const SEARCH_PAGE_SIZE = 80;
const FAVORITE_PAGE_SIZE = 20;
const FAVORITE_PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 60] as const;

type UnknownRecord = Record<string, unknown>;

// ─── Parameter Schemas ────────────────────────────────────────────────────────

const idParamSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

const searchBodySchema = z
  .object({
    keyword: z.string().trim().min(1),
    page: z.coerce.number().int().positive().optional().default(1),
    /**
     * Search scope matching Python JmApiClient main_tag:
     *  0 = site-wide (default), 1 = works, 2 = author, 3 = tag, 4 = actor
     */
    main_tag: z.coerce.number().int().min(0).max(4).optional().default(0),
    /** Sort order: mr=最新, mv=最多观看, mp=最多图片, tf=最多收藏 */
    order_by: z.enum(ORDER_BY_VALUES).optional().default("mr"),
    /** Time range: a=全部, t=今天, w=本周, m=本月 */
    time: z.enum(TIME_VALUES).optional().default("a"),
  })
  .strict();

const categoriesBodySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    /** Category — empty string means "all". */
    category: z.enum(CATEGORY_VALUES).optional().default(""),
    /** Optional sub-category, matching Python categories_filter(category/sub_category) URL semantics. */
    sub_category: z.string().trim().min(1).optional(),
    /** Sort order. */
    order_by: z.enum(ORDER_BY_VALUES).optional().default("mv"),
    /** Time range. */
    time: z.enum(TIME_VALUES).optional().default("a"),
  })
  .strict();

const rankingsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    category: z.enum(CATEGORY_VALUES).optional().default(""),
  })
  .strict();

const homeQuerySchema = z
  .object({
    category: z.enum(CATEGORY_VALUES).optional().default(""),
  })
  .strict();

const favoritesQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    folder_id: z.string().optional().default("0"),
    order_by: z.enum(ORDER_BY_VALUES).optional().default("mr"),
    page_size: z
      .coerce
      .number()
      .int()
      .optional()
      .default(FAVORITE_PAGE_SIZE)
      .refine((value) => FAVORITE_PAGE_SIZE_OPTIONS.includes(value as never), {
        message: "page_size must be 10/20/30/40/60",
      }),
  })
  .strict();

const addFavoriteBodySchema = z
  .object({
    album_id: z.string().min(1),
    folder_id: z.string().optional().default("0"),
  })
  .strict();

const loginBodySchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();

const commentsQuerySchema = z
  .object({
    album_id: z.string().min(1),
    page: z.coerce.number().int().positive().optional().default(1),
    order: z.enum(["asc", "desc"]).optional().default("asc"),
  })
  .strict();

const coverParamSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

const coverQuerySchema = z
  .object({
    /** Size suffix for the cover image, e.g. "_3x4" for thumbnail. */
    size: z.string().optional().default(""),
    format: z.enum(["jpeg", "webp"]).optional().default("webp"),
  })
  .strict();

const imageProxyQuerySchema = z
  .object({
    url: z.string().url(),
    scramble_id: z.string().min(1).optional(),
    aid: z.string().min(1).optional(),
    img_file_name: z.string().min(1).optional(),
    format: z.enum(["jpeg", "webp", "original"]).optional().default("webp"),
    decrypt: z.coerce.boolean().optional().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = ["scramble_id", "aid", "img_file_name"] as const;
    const presentCount = keys.reduce((count, key) => count + (value[key] !== undefined ? 1 : 0), 0);
    if (presentCount !== 0 && presentCount !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "如果要启用图片解密，必须同时提供 scramble_id、aid、img_file_name",
        path: ["scramble_id"],
      });
    }
  });

// ─── JM Client ───────────────────────────────────────────────────────────────

const exportStore = new ExportStore();
void exportStore.ensureRootDir().catch(() => null);

const taskManager = new TaskManager({
  concurrency: Math.max(1, Number(process.env.TASK_CONCURRENCY ?? 2) || 2),
});

const sessionManager = new JmSessionManager({
  createClient: () =>
    new JMComicClient({
      proxy: readProxyFromEnv(),
    }),
  onSessionExpired: async (sessionId) => {
    const tasks = taskManager.listBySession(sessionId);
    taskManager.deleteBySession(sessionId);
    await Promise.all(
      tasks.map((task) =>
        task.result?.filePath ? exportStore.deleteZipIfExists(task.result.filePath) : Promise.resolve(false),
      ),
    );
  },
});

// ─── Hono App ─────────────────────────────────────────────────────────────────

const app = new Hono();

app.route(
  "",
  createTasksRouter({
    taskManager,
    exportStore,
    sessionManager,
  }),
);

function buildSessionCookieHeaderValue(sessionId: string) {
  return buildDeviceSessionCookieHeaderValue(sessionId);
}

function getSessionCookieHeaderValueIfNeeded(request: Request, session: { sessionId: string; isNew: boolean }) {
  // Web 请求一般不会带 x-jm-session header；CLI/脚本可通过 header 显式隔离。
  const hasHeaderSession = request.headers.get("x-jm-session")?.trim();
  return session.isNew && !hasHeaderSession ? buildSessionCookieHeaderValue(session.sessionId) : null;
}

// ── Manga detail ──────────────────────────────────────────────────────────────

app.get("/api/manga/:id", zValidator("param", idParamSchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { id } = c.req.valid("param");
  const albumResponse = await jmClient.fetchAlbumDetail(id);
  const manga = mapAlbumToManga(jmClient, albumResponse.data);
  return c.json(manga);
});

// ── Chapter detail ────────────────────────────────────────────────────────────

app.get("/api/chapter/:id", zValidator("param", idParamSchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { id } = c.req.valid("param");

  const chapterResponse = await jmClient.fetchChapterDetail(id);
  const chapterData = ensureRecord(chapterResponse.data, "chapter");
  const photoId = getString(chapterData.id, id);
  const rawSeriesId = getString(chapterData.series_id, "0");
  const albumId = rawSeriesId === "0" ? photoId : rawSeriesId;

  const [scrambleId, albumData] = await Promise.all([
    jmClient.fetchScrambleId(photoId),
    jmClient
      .fetchAlbumDetail(albumId)
      .then((response) => ensureRecord(response.data, "album"))
      .catch(() => null),
  ]);

  const chapter = mapPhotoToChapter(jmClient, chapterData, {
    album_id: albumId,
    scramble_id: scrambleId,
    author: albumData === null ? DEFAULT_AUTHOR : mapAlbumToManga(jmClient, albumData).author,
    image_domain: jmClient.getImageDomain(),
  });

  return c.json(chapter);
});

// ── Export manifest (client-side packaging) ────────────────────────────────────

app.get("/api/export/album/:id/manifest", zValidator("param", idParamSchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);

  const { id } = c.req.valid("param");
  const origin = new URL(c.req.url).origin;
  const formatParam = new URL(c.req.url).searchParams.get("format");
  const format = formatParam === "jpeg" || formatParam === "webp" || formatParam === "original" ? formatParam : "original";
  const manifest = await fetchAlbumManifest({
    jmClient,
    albumId: id,
    origin,
    format,
  });

  return c.json(manifest);
});

// ── Search ────────────────────────────────────────────────────────────────────

app.post("/api/search", zValidator("json", searchBodySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { keyword, page, main_tag, order_by, time } = c.req.valid("json");

  const response = await jmClient.requestApi(JMComicClient.API_SEARCH, {
    params: {
      main_tag,
      search_query: keyword,
      page,
      o: order_by,
      t: time,
    },
  });

  const model = ensureRecord(response.data, "search");
  const redirectAid = getNullableString(model.redirect_aid);

  if (redirectAid !== null) {
    const album = mapAlbumToManga(jmClient, (await jmClient.fetchAlbumDetail(redirectAid)).data);
    const result = searchResultSchema.parse({
      content: [
        searchResultItemSchema.parse({
          id: album.album_id,
          name: album.name,
          tags: album.tags,
          author: album.author,
          description: album.description,
          image: album.image,
        }),
      ],
      total: 1,
      page_size: SEARCH_PAGE_SIZE,
      page_count: 1,
      is_single_album: true,
      single_album: album,
    });

    return c.json(result);
  }

  const total = getPositiveInt(model.total, 0);
  const content = getRecordArray(model.content).map((item) => mapSearchResultItem(jmClient, item));
  const result = searchResultSchema.parse({
    content,
    total,
    page_size: SEARCH_PAGE_SIZE,
    page_count: total === 0 ? 0 : Math.ceil(total / SEARCH_PAGE_SIZE),
    is_single_album: false,
    single_album: null,
  });

  return c.json(result);
});

// ── Categories / Rankings ─────────────────────────────────────────────────────

/**
 * POST /api/categories
 * Mirrors Python JmApiClient.categories_filter.
 * `o` param calculation: if time == 'a', use order_by directly; otherwise "{order_by}_{time}".
 */
app.post("/api/categories", zValidator("json", categoriesBodySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { page, category, sub_category, order_by, time } = c.req.valid("json");
  return c.json(await fetchCategoryPage(jmClient, page, category, order_by, time, sub_category));
});

/**
 * GET /api/rankings/month?page=&category=
 * Monthly ranking = categories_filter(time=m, order_by=mv)
 */
app.get("/api/rankings/month", zValidator("query", rankingsQuerySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { page, category } = c.req.valid("query");
  return c.json(await fetchCategoryPage(jmClient, page, category, "mv", "m"));
});

/**
 * GET /api/rankings/week?page=&category=
 * Weekly ranking = categories_filter(time=w, order_by=mv)
 */
app.get("/api/rankings/week", zValidator("query", rankingsQuerySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { page, category } = c.req.valid("query");
  return c.json(await fetchCategoryPage(jmClient, page, category, "mv", "w"));
});

/**
 * GET /api/rankings/today?page=&category=
 * Daily ranking = categories_filter(time=t, order_by=mv)
 */
app.get("/api/rankings/today", zValidator("query", rankingsQuerySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { page, category } = c.req.valid("query");
  return c.json(await fetchCategoryPage(jmClient, page, category, "mv", "t"));
});

/**
 * GET /api/home?category=
 * Frontend-friendly homepage aggregate:
 *  - latest = Python categories_filter default homepage semantics
 *  - rankings.today/week/month = Python day/week/month helper semantics
 */
app.get("/api/home", zValidator("query", homeQuerySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { category } = c.req.valid("query");

  const [latest, today, week, month] = await Promise.all([
    fetchCategoryPage(jmClient, 1, category, "mr", "a"),
    fetchCategoryPage(jmClient, 1, category, "mv", "t"),
    fetchCategoryPage(jmClient, 1, category, "mv", "w"),
    fetchCategoryPage(jmClient, 1, category, "mv", "m"),
  ]);

  return c.json(
    homeFeedSchema.parse({
      latest,
      rankings: {
        today,
        week,
        month,
      },
    }),
  );
});

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Mirrors Python JmApiClient.login.
 * On success, the jmClient's internal cookie jar is updated with AVS.
 */
app.post("/api/auth/login", zValidator("json", loginBodySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { username, password } = c.req.valid("json");

  await jmClient.login(username, password);

  // Re-fetch the user info from the decoded response data.
  // jmClient.login() already updated internal cookies.
  const loginResponse = await jmClient.requestApi(JMComicClient.API_LOGIN, {
    method: "POST",
    form: { username, password },
  });

  const data = ensureRecord(loginResponse.data, "login");
  const result = loginResultSchema.parse({
    uid: getString(data.uid),
    username: getString(data.username),
    email: getString(data.email),
    s: getString(data.s),
    message: getString(data.message),
    coin: getPositiveInt(data.coin, 0),
    level: getPositiveInt(data.level, 0),
    level_name: getString(data.level_name),
    album_favorites: getPositiveInt(data.album_favorites, 0),
  });

  return c.json(result);
});

/**
 * POST /api/logout
 * Clear JM login state (cookie jar) but keep the device session id.
 */
app.post("/api/logout", async (c) => {
  const session = sessionManager.get(c.req.raw);
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);

  // If it's an existing device session, replace its JM client instance to clear login cookies.
  if (!session.isNew) {
    sessionManager.resetClient(session.sessionId);
  }

  return c.json({ success: true });
});

app.get("/api/profile", async (c) => {
  const session = sessionManager.get(c.req.raw);
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);

  try {
    const raw = session.client.getCachedProfileSnapshot() ?? (await session.client.fetchProfile());
    return c.json(
      profileResultSchema.parse({
        isLoggedIn: true,
        profile: mapUserProfile(session.client, raw),
        authMessage: "当前会话已连接，可同步头像与资料。",
        error: null,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "资料同步失败，请稍后重试。";
    const isAuthError = /401|請先登入會員|未登录|Need login|Not legal\.user/i.test(message);

    return c.json(
      profileResultSchema.parse({
        isLoggedIn: !isAuthError,
        profile: null,
        authMessage: isAuthError ? "登录后可同步头像、等级、称号与签名。" : "当前资料区没有同步成功。",
        error: message,
      }),
    );
  }
});

// ── Comments (read-only) ──────────────────────────────────────────────────────

/**
 * GET /api/comments?album_id=&page=&order=
 * Mirrors the legacy Python backend: JM upstream `/forum?mode=manhua&aid={id}&page={n}`.
 */
app.get("/api/comments", zValidator("query", commentsQuerySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);

  const { album_id, page, order } = c.req.valid("query");
  const response = await jmClient.requestApi("/forum", {
    params: {
      mode: "manhua",
      aid: album_id,
      page,
    },
  });

  const model = ensureRecord(response.data, "comments");
  const total = getPositiveInt(model.total, 0);
  const list = getRecordArray(model.list);
  const mapped = list.map(mapForumCommentItem);
  const comments = order === "desc" ? [...mapped].reverse() : mapped;

  return c.json(
    commentsResultSchema.parse({
      success: true,
      comments,
      page,
      total,
    }),
  );
});

// ── Favorites ─────────────────────────────────────────────────────────────────

/**
 * GET /api/favorites?page=&folder_id=&order_by=
 * Mirrors Python JmApiClient.favorite_folder.
 * Requires user to be logged in (cookies must contain AVS).
 */
app.get("/api/favorites", zValidator("query", favoritesQuerySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { page, folder_id, order_by, page_size } = c.req.valid("query");

  const desiredPageSize = page_size;
  const upstreamPageSize = FAVORITE_PAGE_SIZE;
  const offset = (page - 1) * desiredPageSize;
  const upstreamStartPage = Math.floor(offset / upstreamPageSize) + 1;
  const upstreamEndPage =
    Math.floor((offset + desiredPageSize - 1) / upstreamPageSize) + 1;
  const upstreamPages = Array.from(
    { length: upstreamEndPage - upstreamStartPage + 1 },
    (_, index) => upstreamStartPage + index,
  );

  const responses = await Promise.all(
    upstreamPages.map((upstreamPage) =>
      jmClient.requestApi(JMComicClient.API_FAVORITE, {
        params: {
          page: upstreamPage,
          folder_id,
          o: order_by,
        },
      }),
    ),
  );

  const firstModel = ensureRecord(responses[0]?.data, "favorites");
  const rawFolders = getRecordArray(firstModel.folder_list);
  const total = getPositiveInt(firstModel.total, 0);

  const concatenatedRawList = responses.flatMap((response) => {
    const model = ensureRecord(response.data, "favorites");
    return getRecordArray(model.list);
  });
  const localStartIndex = offset - (upstreamStartPage - 1) * upstreamPageSize;
  const slicedRawList = concatenatedRawList.slice(
    localStartIndex,
    localStartIndex + desiredPageSize,
  );

  const list = slicedRawList.map((item) => mapFavoriteItem(jmClient, item));
  const folder_list = rawFolders.map((folder) =>
    favoriteFolderSchema.parse({
      FID: getString(folder.FID ?? folder["0"], "0"),
      name: getString(folder.name ?? folder["2"]),
    }),
  );

  const result = favoritesResultSchema.parse({
    list,
    folder_list,
    total,
    page_size: desiredPageSize,
    page_count: total === 0 ? 0 : Math.ceil(total / desiredPageSize),
  });

  return c.json(result);
});

/**
 * POST /api/favorites
 * Mirrors Python JmApiClient.add_favorite_album.
 * Requires user to be logged in.
 */
app.post("/api/favorites", zValidator("json", addFavoriteBodySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);
  const { album_id, folder_id } = c.req.valid("json");

  await jmClient.requestApi(JMComicClient.API_FAVORITE, {
    method: "POST",
    form: { aid: album_id, folder_id },
  });

  return c.json({ success: true, album_id });
});

// ── Cover image proxy ─────────────────────────────────────────────────────────

/**
 * GET /api/cover/:id?size=&format=
 * Proxies the manga cover image through our server.
 * Covers are NOT scrambled, so no decryption is applied.
 * `size` can be "" (full) or "_3x4" (thumbnail used in search lists).
 */
app.get(
  "/api/cover/:id",
  zValidator("param", coverParamSchema),
  zValidator("query", coverQuerySchema),
  async (c) => {
    const session = sessionManager.get(c.req.raw);
    const jmClient = session.client;
    const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
    const { id } = c.req.valid("param");
    const { size, format } = c.req.valid("query");

    const domain = jmClient.getImageDomain();
    const coverUrl = `https://${domain}/media/albums/${id}${size}.jpg`;

    const response = await jmClient.fetchImageResponse(coverUrl);

    if (!response.ok) {
      const errResponse = new Response(JSON.stringify({ error: `封面图代理失败，HTTP ${response.status}` }), {
        status: response.status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
      if (cookie) errResponse.headers.set("Set-Cookie", cookie);
      return errResponse;
    }

    const upstreamBytes = new Uint8Array(await response.arrayBuffer());
    const sourceContentType = detectImageContentType(upstreamBytes, response.headers.get("content-type"));

    // Covers are never scrambled; just re-encode to the requested format.
    const result = await jmClient.encodeImage(upstreamBytes, format);
    const out = createImageResponse(result, sourceContentType);
    if (cookie) out.headers.set("Set-Cookie", cookie);
    return out;
  },
);

// ── Image proxy ───────────────────────────────────────────────────────────────

app.get("/api/image/proxy", zValidator("query", imageProxyQuerySchema), async (c) => {
  const session = sessionManager.get(c.req.raw);
  const jmClient = session.client;
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  const query = c.req.valid("query");
  const response = await jmClient.fetchImageResponse(query.url);

  if (!response.ok) {
    const errResponse = new Response(JSON.stringify({ error: `图片代理失败，HTTP ${response.status}` }), {
      status: response.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
    if (cookie) errResponse.headers.set("Set-Cookie", cookie);
    return errResponse;
  }

  const upstreamBytes = new Uint8Array(await response.arrayBuffer());
  const sourceContentType = detectImageContentType(upstreamBytes, response.headers.get("content-type"));
  const resolvedFormat: "jpeg" | "webp" =
    query.format === "original"
      ? sourceContentType.includes("jpeg")
        ? "jpeg"
        : sourceContentType.includes("webp")
          ? "webp"
          : "webp"
      : query.format;
  const canDecrypt =
    query.decrypt === true &&
    query.scramble_id !== undefined &&
    query.aid !== undefined &&
    query.img_file_name !== undefined;

  if (!canDecrypt) {
    if (query.format === "original") {
      const out = new Response(new Blob([Buffer.from(upstreamBytes)], { type: sourceContentType }).stream(), {
        headers: {
          "content-type": sourceContentType,
          "cache-control": "public, max-age=300",
          "x-jm-source-content-type": sourceContentType,
        },
      });
      if (cookie) out.headers.set("Set-Cookie", cookie);
      return out;
    }

    const result = await jmClient.encodeImage(upstreamBytes, resolvedFormat);
    const out = createImageResponse(result, sourceContentType);
    if (cookie) out.headers.set("Set-Cookie", cookie);
    return out;
  }

  const result = await jmClient.decryptImage(upstreamBytes, {
    scramble_id: query.scramble_id!,
    aid: query.aid!,
    img_file_name: query.img_file_name!,
    format: resolvedFormat,
  });

  const out = createImageResponse(result, sourceContentType);
  if (cookie) out.headers.set("Set-Cookie", cookie);
  return out;
});

// ── Global error handler ──────────────────────────────────────────────────────

app.onError((error, c) => {
  const message = error instanceof Error ? error.message : "未知服务端异常";
  return c.json({ error: message }, 500);
});

export type AppType = typeof app;
export default app;

// ─── Helpers: env ─────────────────────────────────────────────────────────────

function readProxyFromEnv(): string | undefined {
  const env = process.env;
  return env.JM_PROXY_URL ?? env.HTTP_PROXY ?? env.HTTPS_PROXY ?? undefined;
}

// ─── Helpers: category / ranking ──────────────────────────────────────────────

/**
 * Shared logic for categories_filter, mirroring Python JmApiClient.categories_filter.
 *
 * `o` param rule:
 *  - time == 'a' → use order_by directly (e.g. "mv")
 *  - time != 'a' → "{order_by}_{time}" (e.g. "mv_m" = most-viewed this month)
 */
async function fetchCategoryPage(
  jmClient: JMComicClient,
  page: number,
  category: string,
  order_by: string,
  time: string,
  sub_category?: string,
) {
  const o = time === "a" ? order_by : `${order_by}_${time}`;
  const path = buildCategoryFilterPath(category, sub_category);

  const response = await jmClient.requestApi(path, {
    params: {
      page,
      order: "",
      c: category,
      o,
    },
  });

  const model = ensureRecord(response.data, "categories");
  const total = getPositiveInt(model.total, 0);
  const content = getRecordArray(model.content).map((item) => mapSearchResultItem(jmClient, item));

  return categoryResultSchema.parse({
    content,
    total,
    page_size: SEARCH_PAGE_SIZE,
    page_count: total === 0 ? 0 : Math.ceil(total / SEARCH_PAGE_SIZE),
  });
}

function buildCategoryFilterPath(category: string, sub_category?: string) {
  const base = "/categories/filter";
  if (category.length === 0) {
    return base;
  }

  if (!sub_category || sub_category.length === 0) {
    return `${base}/${category}`;
  }

  return `${base}/${category}/sub/${sub_category}`;
}

// ─── Helpers: mappers ─────────────────────────────────────────────────────────

function mapAlbumToManga(jmClient: JMComicClient, input: unknown) {
  const data = ensureRecord(input, "album");
  const albumId = getString(data.id);
  const authors = normalizeList(data.author);
  const tags = normalizeTagList(data.tags);
  const relatedList = getRecordArray(data.related_list).map((item) => mapSearchResultItem(jmClient, item));

  const rawEpisodes = getRecordArray(data.series).map((item) => ({
    photo_id: getString(item.id),
    sort: getString(item.sort, "1"),
    name: getString(item.name),
  }));

  const episodeList =
    rawEpisodes.length === 0
      ? [{ photo_id: albumId, sort: "1", name: getString(data.name) }]
      : dedupeEpisodes(rawEpisodes);

  return mangaSchema.parse({
    album_id: albumId,
    scramble_id: getString(data.scramble_id, "0"),
    name: getString(data.name),
    image: getNullableString(data.image) ?? jmClient.buildAlbumCoverUrl(albumId, ""),
    description: getString(data.description, ""),
    page_count: getPositiveInt(data.page_count, normalizeList(data.images).length),
    pub_date: getString(data.pub_date, "0"),
    update_date: getString(data.update_date, "0"),
    likes: getString(data.likes, "0"),
    views: getString(data.total_views ?? data.views, "0"),
    comment_count: getPositiveInt(data.comment_total ?? data.comment_count, 0),
    works: normalizeList(data.works),
    actors: normalizeList(data.actors),
    authors,
    author: authors[0] ?? DEFAULT_AUTHOR,
    tags,
    episode_list: episodeList,
    related_list: relatedList,
  });
}

function mapPhotoToChapter(
  jmClient: JMComicClient,
  input: unknown,
  options: {
    album_id: string;
    scramble_id: string;
    author: string;
    image_domain: string;
  },
) {
  const data = ensureRecord(input, "chapter");
  const photoId = getString(data.id);
  const pageArr = normalizeList(data.images);
  const seriesId = getString(data.series_id, "0");
  const isSingleAlbum = seriesId === "0";
  const sort = resolveChapterSort(data, photoId);
  const albumIndex = isSingleAlbum && sort === 2 ? 1 : sort;
  const queryParams = extractQueryParams(getNullableString(data.data_original_0));
  const firstImageUrl = pageArr[0] === undefined ? null : jmClient.buildImageUrl(photoId, pageArr[0], options.image_domain);

  const imageList = pageArr.map((imageFileName, index) => {
    const imageUrl = jmClient.buildImageUrl(photoId, imageFileName, options.image_domain);
    const { name, suffix } = splitFileName(imageFileName);

    return imageSchema.parse({
      aid: photoId,
      scramble_id: options.scramble_id,
      img_url: imageUrl,
      img_file_name: name,
      img_file_suffix: suffix,
      query_params: queryParams,
      index: index + 1,
      download_url: queryParams === null ? imageUrl : `${imageUrl}?${queryParams}`,
    });
  });

  return chapterSchema.parse({
    photo_id: photoId,
    name: getString(data.name),
    series_id: seriesId,
    sort,
    tags: normalizeTagList(data.tags),
    scramble_id: options.scramble_id,
    page_arr: pageArr,
    data_original_domain: options.image_domain,
    data_original_0: firstImageUrl,
    data_original_query_params: queryParams,
    author: options.author,
    album_id: options.album_id,
    album_index: albumIndex,
    index: albumIndex,
    is_single_album: isSingleAlbum,
    indextitle: `第${albumIndex}話 ${getString(data.name)}`,
    image_list: imageList,
  });
}

function mapSearchResultItem(jmClient: JMComicClient, input: unknown) {
  const data = ensureRecord(input, "search item");
  const albumId = getString(data.id);
  return searchResultItemSchema.parse({
    id: albumId,
    name: getString(data.name),
    tags: normalizeTagList(data.tags),
    author: getNullableString(data.author),
    description: getNullableString(data.description),
    image: getNullableString(data.image) ?? jmClient.buildAlbumCoverUrl(albumId, "_3x4"),
  });
}

function mapFavoriteItem(jmClient: JMComicClient, input: unknown) {
  const data = ensureRecord(input, "favorite item");
  const albumId = getString(data.id);
  return favoriteItemSchema.parse({
    id: albumId,
    name: getString(data.name),
    latest_ep: getNullableString(data.latest_ep),
    latest_ep_aid: getNullableString(data.latest_ep_aid),
    image: getNullableString(data.image) ?? jmClient.buildAlbumCoverUrl(albumId, "_3x4"),
    author: getNullableString(data.author),
  });
}

function mapProfileField(data: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = getNullableString(data[key]);
    if (value !== null && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function mapUserProfile(jmClient: JMComicClient, input: unknown) {
  const data = ensureRecord(input, "profile");
  const avatar = mapProfileAvatar(jmClient, pickProfileAvatarValue(data));
  return profileSchema.parse({
    username: mapProfileField(data, ["username", "user_name", "name"]),
    nickname: mapProfileField(data, ["nickname", "nick_name", "show_name"]),
    avatar,
    level: mapProfileField(data, ["level", "grade"]),
    title: mapProfileField(data, ["title", "rank_title", "user_title", "level_name"]),
    badge: mapProfileField(data, ["badge", "badge_name", "frame_title"]),
    signature: mapProfileField(data, ["signature", "sign", "brief"]),
  });
}

function pickProfileAvatarValue(data: UnknownRecord) {
  const direct = mapProfileField(data, ["avatar_url", "avatar"]);
  if (direct !== null) {
    return direct;
  }

  const raw = ensureOptionalRecord(data.raw);
  if (raw !== null) {
    const fromRaw = mapProfileField(raw, ["avatar_url", "avatar", "photo"]);
    if (fromRaw !== null) {
      return fromRaw;
    }
  }

  return mapProfileField(data, ["photo"]);
}

function mapProfileAvatar(jmClient: JMComicClient, avatar: string | null) {
  if (avatar === null) return null;

  const value = avatar.trim();
  if (value.length === 0 || value.startsWith("nopic-")) {
    return null;
  }

  const upstreamUrl = resolveProfileAvatarUrl(jmClient, value);
  if (upstreamUrl === null) {
    return null;
  }

  const params = new URLSearchParams({
    url: upstreamUrl,
    decrypt: "false",
    format: "original",
  });
  return `/api/image/proxy?${params.toString()}`;
}

function resolveProfileAvatarUrl(jmClient: JMComicClient, avatar: string) {
  if (/^https?:\/\//i.test(avatar)) {
    return avatar;
  }

  const base = `${JMComicClient.PROTOCOL}${jmClient.getImageDomain()}`;

  if (avatar.includes("/media/users/")) {
    return `${base}${avatar.startsWith("/") ? "" : "/"}${avatar}`;
  }

  if (avatar.includes("?") || avatar.includes("#")) {
    return `${base}/media/users/${avatar}`;
  }

  return `${base}/media/users/${encodeURIComponent(avatar)}`;
}

function ensureOptionalRecord(input: unknown): UnknownRecord | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  return input as UnknownRecord;
}

function mapForumCommentItem(input: unknown) {
  const data = ensureRecord(input, "comment item");
  const id = getString((data as Record<string, unknown>).CID ?? (data as Record<string, unknown>).id);
  const user = getNullableString((data as Record<string, unknown>).nickname ?? (data as Record<string, unknown>).username);
  const rawParent = getNullableString((data as Record<string, unknown>).parent_CID ?? (data as Record<string, unknown>).parent_id);
  const parent_id = rawParent === null || rawParent === "0" ? null : rawParent;
  const rawContent = getString((data as Record<string, unknown>).content, "");
  const content = stripCommentHtml(rawContent);
  const time = getNullableString((data as Record<string, unknown>).addtime ?? (data as Record<string, unknown>).created_at);
  const likes = getPositiveInt((data as Record<string, unknown>).likes, 0);

  return commentItemSchema.parse({
    id,
    user,
    content,
    time,
    likes,
    parent_id,
  });
}

// ─── Helpers: data normalization ──────────────────────────────────────────────

function dedupeEpisodes(episodes: Array<{ photo_id: string; sort: string; name: string }>) {
  const ordered = [...episodes].sort((left, right) => Number(left.sort) - Number(right.sort));
  const deduped: Array<{ photo_id: string; sort: string; name: string }> = [];

  for (const episode of ordered) {
    if (deduped.at(-1)?.sort !== episode.sort) {
      deduped.push(episode);
    }
  }

  return deduped;
}

function resolveChapterSort(input: UnknownRecord, photoId: string): number {
  const series = getRecordArray(input.series);
  for (const chapter of series) {
    if (getString(chapter.id) === photoId) {
      return getPositiveInt(chapter.sort, 1);
    }
  }

  return getPositiveInt(input.sort, 1);
}

function normalizeList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? [] : [trimmed];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeTagList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return normalizeList(value);
}

function getRecordArray(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is UnknownRecord => typeof item === "object" && item !== null);
}

function ensureRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} 数据结构异常`);
  }

  return value as UnknownRecord;
}

function getString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return fallback;
}

function getNullableString(value: unknown): string | null {
  const text = getString(value);
  return text.length === 0 ? null : text;
}

function getPositiveInt(value: unknown, fallback: number): number {
  const text = getString(value, String(fallback));
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}


function stripCommentHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function extractQueryParams(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const queryIndex = value.indexOf("?");
  if (queryIndex === -1 || queryIndex === value.length - 1) {
    return null;
  }

  return value.slice(queryIndex + 1);
}

function splitFileName(fileName: string): { name: string; suffix: string } {
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index === fileName.length - 1) {
    return {
      name: fileName,
      suffix: ".jpg",
    };
  }

  return {
    name: fileName.slice(0, index),
    suffix: fileName.slice(index),
  };
}

// ─── Helpers: image response ──────────────────────────────────────────────────

function detectImageContentType(bytes: Uint8Array, upstreamContentType: string | null): string {
  if (upstreamContentType !== null && upstreamContentType.startsWith("image/")) {
    return upstreamContentType;
  }

  if (bytes.length >= 12) {
    const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (riff && webp) {
      return "image/webp";
    }
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  return "application/octet-stream";
}

function createImageResponse(result: JmImageEncodeResult, sourceContentType: string) {
  const body = new Blob([Buffer.from(result.data)], { type: result.contentType }).stream();

  return new Response(body, {
    headers: {
      "content-type": result.contentType,
      "cache-control": "public, max-age=300",
      "x-jm-source-content-type": sourceContentType,
      "x-jm-image-width": String(result.width),
      "x-jm-image-height": String(result.height),
      "x-jm-image-channels": String(result.channels),
      "x-jm-segment-count": String(result.segmentCount),
    },
  });
}
