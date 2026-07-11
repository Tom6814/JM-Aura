import { z } from "zod";

export const chapterSummarySchema = z
  .object({
    /** Chapter JM ID. */
    photo_id: z.string().min(1),
    /** Original chapter sort value from `episode_list`. */
    sort: z.string().min(1),
    /** Chapter title. */
    name: z.string(),
  })
  .strict();

export type ChapterSummary = z.infer<typeof chapterSummarySchema>;

export const imageSchema = z
  .object({
    /** Chapter JM ID that owns this image. */
    aid: z.string().min(1),
    /** Scramble seed used to restore shuffled image slices. */
    scramble_id: z.string().min(1),
    /** Raw upstream image URL without extra query params merged in. */
    img_url: z.string().url(),
    /** Image filename without suffix, for example `00001`. */
    img_file_name: z.string().min(1),
    /** Image suffix including the leading dot, for example `.webp`. */
    img_file_suffix: z.string().min(1),
    /** Query string extracted from upstream `data-original`, usually `v=...`. */
    query_params: z.string().nullable(),
    /** One-based image index inside the chapter. */
    index: z.number().int().positive(),
    /** Fully qualified downloadable image URL used by the frontend image stream. */
    download_url: z.string().url(),
  })
  .strict();

export type Image = z.infer<typeof imageSchema>;

export const chapterSchema = z
  .object({
    /** Chapter JM ID. */
    photo_id: z.string().min(1),
    /** Chapter title. */
    name: z.string(),
    /** Parent manga ID. Single-chapter manga uses its own `photo_id`. */
    series_id: z.string().min(1),
    /** Chapter order in the manga. */
    sort: z.number().int().positive(),
    /** Normalized tag list for frontend filtering and rendering. */
    tags: z.array(z.string()),
    /** Scramble seed used by image restoration logic. */
    scramble_id: z.string().min(1),
    /** Raw upstream image filename list, matching Python `page_arr`. */
    page_arr: z.array(z.string().min(1)),
    /** Upstream image CDN domain. */
    data_original_domain: z.string().nullable(),
    /** First upstream image URL used to recover shared query params. */
    data_original_0: z.string().nullable(),
    /** Query string extracted from `data_original_0`, usually `v=...`. */
    data_original_query_params: z.string().nullable(),
    /** Normalized author string. */
    author: z.string(),
    /** Parent manga ID exposed directly for Remix route loaders. */
    album_id: z.string().min(1),
    /** One-based chapter index after single-album normalization. */
    album_index: z.number().int().positive(),
    /** Mirrors Python's `self.index = self.album_index`. */
    index: z.number().int().positive(),
    /** Whether the manga has only one chapter. */
    is_single_album: z.boolean(),
    /** Human-friendly title such as `第1話 xxx`. */
    indextitle: z.string(),
    /** Materialized image objects for frontend consumption. */
    image_list: z.array(imageSchema),
  })
  .strict();

export type Chapter = z.infer<typeof chapterSchema>;

export const searchResultItemSchema = z
  .object({
    /** Manga JM ID. */
    id: z.string().min(1),
    /** Manga title shown in search results. */
    name: z.string(),
    /** Normalized tag list. HTML results may return an empty array. */
    tags: z.array(z.string()),
    /** Optional author string from API search results. */
    author: z.string().nullable(),
    /** Optional description from API search results. */
    description: z.string().nullable(),
    /** Optional cover path or image URL from API search results. */
    image: z.string().nullable(),
  })
  .strict();

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const mangaSchema = z
  .object({
    /** Manga JM ID. */
    album_id: z.string().min(1),
    /** Scramble seed shared by the manga and its chapters. */
    scramble_id: z.string().min(1),
    /** Manga title. */
    name: z.string(),
    /** Optional manga cover image URL from upstream detail/search payload. */
    image: z.string().nullable(),
    /** Manga description text. */
    description: z.string(),
    /** Total page count across the manga. */
    page_count: z.number().int().nonnegative(),
    /** Original publish date string from upstream. */
    pub_date: z.string(),
    /** Original update date string from upstream. */
    update_date: z.string(),
    /** Like count string preserved from upstream formatting. */
    likes: z.string(),
    /** View count string preserved from upstream formatting. */
    views: z.string(),
    /** Total comment count. */
    comment_count: z.number().int().nonnegative(),
    /** Work/franchise labels. */
    works: z.array(z.string()),
    /** Character labels. */
    actors: z.array(z.string()),
    /** Author list from upstream. */
    authors: z.array(z.string()),
    /** Primary author string for direct rendering. */
    author: z.string(),
    /** Tag list used by search and filters. */
    tags: z.array(z.string()),
    /** Named chapter summaries derived from Python `episode_list`. */
    episode_list: z.array(chapterSummarySchema),
    /** Related manga cards returned by the API detail endpoint. */
    related_list: z.array(searchResultItemSchema),
  })
  .strict();

export type Manga = z.infer<typeof mangaSchema>;

export const searchResultSchema = z
  .object({
    /** Current page search hits. */
    content: z.array(searchResultItemSchema),
    /** Total matched manga count. */
    total: z.number().int().nonnegative(),
    /** Page size after backend normalization. */
    page_size: z.number().int().positive(),
    /** Total available page count. */
    page_count: z.number().int().nonnegative(),
    /** Whether the search redirected to a single exact manga match. */
    is_single_album: z.boolean(),
    /** Full manga payload when `is_single_album` is true, otherwise `null`. */
    single_album: mangaSchema.nullable(),
  })
  .strict();

export type SearchResult = z.infer<typeof searchResultSchema>;

// ─── Category / Ranking ───────────────────────────────────────────────────────

/**
 * Search main_tag values (matching Python JmApiClient).
 *  0 = site-wide (default)
 *  1 = works
 *  2 = author
 *  3 = tag
 *  4 = actor/character
 */
export const SEARCH_MAIN_TAGS = [0, 1, 2, 3, 4] as const;
export type SearchMainTag = (typeof SEARCH_MAIN_TAGS)[number];

/**
 * Sort order values.
 *  mr = 最新 (most recent)
 *  mv = 最多观看 (most views)
 *  mp = 最多图片 (most pages)
 *  tf = 最多收藏 (most favorites)
 */
export const ORDER_BY_VALUES = ["mr", "mv", "mp", "tf"] as const;
export type OrderBy = (typeof ORDER_BY_VALUES)[number];

/**
 * Time range filter values.
 *  a  = 全部 (all time)
 *  t  = 今天 (today)
 *  w  = 本周 (this week)
 *  m  = 本月 (this month)
 */
export const TIME_VALUES = ["a", "t", "w", "m"] as const;
export type TimeRange = (typeof TIME_VALUES)[number];

/**
 * Category values mirroring Python JmMagicConstants.
 *  empty string = 全部 (all)
 */
export const CATEGORY_VALUES = [
  "",
  "doujin",
  "single",
  "short",
  "another",
  "hanman",
  "meiman",
  "doujin_3d",
  "doujin_cg",
] as const;
export type Category = (typeof CATEGORY_VALUES)[number];

/** Paged result from the `/api/categories` endpoint. */
export const categoryResultSchema = z
  .object({
    /** Current page items. Reuses searchResultItemSchema since the shape is identical. */
    content: z.array(searchResultItemSchema),
    /** Total matched count. */
    total: z.number().int().nonnegative(),
    /** Page size (fixed at 80 by JM API). */
    page_size: z.number().int().positive(),
    /** Total available page count. */
    page_count: z.number().int().nonnegative(),
  })
  .strict();

export type CategoryResult = z.infer<typeof categoryResultSchema>;

/** Aggregated home feed for the frontend first screen. */
export const homeFeedSchema = z
  .object({
    /** Latest / newest feed, mirroring Python categories_filter default homepage semantics. */
    latest: categoryResultSchema,
    /** Shortcut ranking blocks mirroring Python day/week/month helpers. */
    rankings: z
      .object({
        today: categoryResultSchema,
        week: categoryResultSchema,
        month: categoryResultSchema,
      })
      .strict(),
  })
  .strict();

export type HomeFeed = z.infer<typeof homeFeedSchema>;

// ─── Favorites ────────────────────────────────────────────────────────────────

/** Single entry in the favorites list. */
export const favoriteItemSchema = z
  .object({
    /** Manga JM ID. */
    id: z.string().min(1),
    /** Manga title. */
    name: z.string(),
    /** Latest episode name, null when not available. */
    latest_ep: z.string().nullable(),
    /** Latest episode album ID, null when not available. */
    latest_ep_aid: z.string().nullable(),
    /** Cover image path or URL (may be empty string → returned as null). */
    image: z.string().nullable(),
    /** Author string. */
    author: z.string().nullable(),
  })
  .strict();

export type FavoriteItem = z.infer<typeof favoriteItemSchema>;

/** Single folder entry from the favorites folder list. */
export const favoriteFolderSchema = z
  .object({
    /** Folder ID. `"0"` represents the default "all" folder. */
    FID: z.string(),
    /** Folder display name. */
    name: z.string(),
  })
  .strict();

export type FavoriteFolder = z.infer<typeof favoriteFolderSchema>;

/** Paged response from the `GET /api/favorites` endpoint. */
export const favoritesResultSchema = z
  .object({
    /** Favorites on this page. */
    list: z.array(favoriteItemSchema),
    /** All available folders for the current user. */
    folder_list: z.array(favoriteFolderSchema),
    /** Total favorited manga count (across all folders). */
    total: z.number().int().nonnegative(),
    /** Page size (fixed by JM API, typically 20). */
    page_size: z.number().int().positive(),
    /** Total available page count. */
    page_count: z.number().int().nonnegative(),
  })
  .strict();

export type FavoritesResult = z.infer<typeof favoritesResultSchema>;

// ─── Profile ──────────────────────────────────────────────────────────────────

export const profileSchema = z
  .object({
    username: z.string().nullable(),
    nickname: z.string().nullable(),
    avatar: z.string().nullable(),
    level: z.string().nullable(),
    title: z.string().nullable(),
    badge: z.string().nullable(),
    signature: z.string().nullable(),
  })
  .strict();

export type Profile = z.infer<typeof profileSchema>;

export const profileResultSchema = z
  .object({
    isLoggedIn: z.boolean(),
    profile: profileSchema.nullable(),
    authMessage: z.string(),
    error: z.string().nullable(),
  })
  .strict();

export type ProfileResult = z.infer<typeof profileResultSchema>;

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** Response from the `POST /api/auth/login` endpoint. */
export const loginResultSchema = z
  .object({
    /** Numeric user ID as string. */
    uid: z.string(),
    /** Username. */
    username: z.string(),
    /** Email address. */
    email: z.string(),
    /** AVS session token — must be set as cookie for authenticated requests. */
    s: z.string(),
    /** Server welcome message, e.g. `"Welcome xxx!"`. */
    message: z.string(),
    /** Current coin balance. */
    coin: z.number().int().nonnegative(),
    /** User level number. */
    level: z.number().int().nonnegative(),
    /** User level display name. */
    level_name: z.string(),
    /** Total favorited album count. */
    album_favorites: z.number().int().nonnegative(),
  })
  .strict();

export type LoginResult = z.infer<typeof loginResultSchema>;

// ─── Comments ─────────────────────────────────────────────────────────────────

export const commentItemSchema = z
  .object({
    /** Comment ID. */
    id: z.string().min(1),
    /** User nickname / username (may be null when anonymous). */
    user: z.string().nullable(),
    /** Plain text content (HTML stripped). */
    content: z.string(),
    /** Upstream time string. */
    time: z.string().nullable(),
    /** Like count when available. */
    likes: z.number().int().nonnegative().nullable(),
    /** Parent comment id for replies (optional). */
    parent_id: z.string().nullable(),
  })
  .strict();

export type CommentItem = z.infer<typeof commentItemSchema>;

export const commentsResultSchema = z
  .object({
    success: z.boolean(),
    comments: z.array(commentItemSchema),
    page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export type CommentsResult = z.infer<typeof commentsResultSchema>;
