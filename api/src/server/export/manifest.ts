import type { JMComicClient } from "../jmClient";

export type AlbumManifest = {
  albumId: string;
  chapters: ManifestChapter[];
};

export type ManifestChapter = {
  chapterId: string;
  sort: string;
  pages: ManifestPage[];
};

export type ManifestPage = {
  /**
   * Upstream page filename (including suffix), e.g. "00001.webp".
   * Useful for stable ordering and for extracting base name.
   */
  fileName: string;
  /**
   * Fully qualified URL to our image proxy endpoint.
   * The proxy URL includes the required params for server-side decryption.
   */
  proxyUrl: string;
};

export type FetchAlbumManifestOptions = {
  jmClient: Pick<JMComicClient, "fetchAlbumDetail" | "fetchChapterDetail" | "fetchScrambleId" | "buildImageUrl">;
  albumId: string;
  /**
   * API origin used to construct absolute proxy URLs, e.g. "http://127.0.0.1:8787".
   */
  origin: string;
  /**
   * Output image format produced by the proxy.
   * Defaults to "original" for CLI-friendly exports.
   */
  format?: "original" | "webp" | "jpeg";
};

type AlbumChapter = { chapterId: string; sort: string };

export async function fetchAlbumManifest(options: FetchAlbumManifestOptions): Promise<AlbumManifest> {
  const { jmClient, albumId } = options;
  const format = options.format ?? "original";

  const albumResponse = await jmClient.fetchAlbumDetail(albumId);
  const chapters = normalizeAlbumChapters(albumResponse.data, albumId);

  // Explicitly sort by numeric sort (ascending) to make the manifest stable.
  const sorted = [...chapters].sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));

  const manifestChapters: ManifestChapter[] = [];

  for (const chapter of sorted) {
    const [chapterResponse, scrambleId] = await Promise.all([
      jmClient.fetchChapterDetail(chapter.chapterId),
      jmClient.fetchScrambleId(chapter.chapterId),
    ]);
    const pageFiles = normalizeChapterImages(chapterResponse.data);

    const pages: ManifestPage[] = pageFiles.map((fileName) => {
      const { name: baseName } = splitFileName(fileName);
      const upstreamUrl = jmClient.buildImageUrl(chapter.chapterId, fileName);
      const proxyUrl = buildImageProxyUrl({
        origin: options.origin,
        upstreamUrl,
        scrambleId,
        aid: chapter.chapterId,
        imgFileName: baseName,
        format,
      });
      return { fileName, proxyUrl };
    });

    manifestChapters.push({
      chapterId: chapter.chapterId,
      sort: chapter.sort,
      pages,
    });
  }

  return { albumId, chapters: manifestChapters };
}

export function buildImageProxyUrl(options: {
  origin: string;
  upstreamUrl: string;
  scrambleId: string;
  aid: string;
  imgFileName: string;
  format: "original" | "webp" | "jpeg";
}): string {
  const u = new URL("/api/image/proxy", options.origin);
  u.searchParams.set("url", options.upstreamUrl);
  u.searchParams.set("scramble_id", options.scrambleId);
  u.searchParams.set("aid", options.aid);
  u.searchParams.set("img_file_name", options.imgFileName);
  u.searchParams.set("format", options.format);
  return u.toString();
}

function normalizeAlbumChapters(albumData: unknown, albumId: string): AlbumChapter[] {
  const record = ensureRecord(albumData, "albumDetail");
  const series = getRecordArray(record["series"]);

  if (series.length === 0) {
    return [{ chapterId: albumId, sort: "1" }];
  }

  return series.map((item) => ({
    chapterId: getString(item["id"], albumId),
    sort: getString(item["sort"], "1"),
  }));
}

function normalizeChapterImages(chapterData: unknown): string[] {
  const record = ensureRecord(chapterData, "chapterDetail");
  return normalizeStringList(record["images"]);
}

function splitFileName(fileName: string): { name: string; suffix: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { name: fileName, suffix: "" };
  return { name: fileName.slice(0, dot), suffix: fileName.slice(dot) };
}

type UnknownRecord = Record<string, unknown>;

function ensureRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} 数据结构异常`);
  }
  return value as UnknownRecord;
}

function getRecordArray(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UnknownRecord => typeof item === "object" && item !== null);
}

function getString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? [trimmed] : [];
  }

  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
