import { JMComicClient, type JmImageOutputFormat } from "../jmClient";
import { Semaphore } from "../task/semaphore";
import { ZipStoreWriter } from "./zip/zipStoreWriter";

export const DEFAULT_EXPORT_CONCURRENCY = 4;

export interface ExportLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

const DEFAULT_LOGGER: ExportLogger = {
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

export type ExportAlbumToZipOptions = {
  jmClient: Pick<
    JMComicClient,
    "fetchAlbumDetail" | "fetchChapterDetail" | "fetchImageResponse" | "decryptImage" | "buildImageUrl" | "fetchScrambleId"
  >;
  albumId: string;
  chapterIds?: string[];
  zipPath: string;
  imageFormat: "original" | "webp" | "jpeg";
  concurrency?: number;
  logger?: ExportLogger;
};

type AlbumChapter = { chapterId: string; chapterSort: string };

export type ExportFavoritesToZipOptions = {
  jmClient: Pick<
    JMComicClient,
    | "requestApi"
    | "fetchAlbumDetail"
    | "fetchChapterDetail"
    | "fetchImageResponse"
    | "decryptImage"
    | "buildImageUrl"
    | "fetchScrambleId"
  >;
  zipPath: string;
  folderId: string;
  orderBy: string;
  imageFormat: "original" | "webp" | "jpeg";
  concurrency?: number;
  logger?: ExportLogger;
};

type FavoriteAlbum = { albumId: string; name: string };

export async function exportAlbumToZip(options: ExportAlbumToZipOptions): Promise<void> {
  const { jmClient, albumId, zipPath, imageFormat } = options;
  const logger = options.logger ?? DEFAULT_LOGGER;
  const concurrency = normalizeConcurrency(options.concurrency);
  const startedAt = Date.now();

  const writer = await ZipStoreWriter.open(zipPath);
  const downloadSemaphore = new Semaphore(concurrency);
  const writeSemaphore = new Semaphore(1);

  try {
    logger.info("album export started", {
      albumId,
      concurrency,
      imageFormat,
      zipPath,
    });
    const summary = await exportAlbumToWriter({
      jmClient,
      albumId,
      chapterIds: options.chapterIds,
      imageFormat,
      writer,
      downloadSemaphore,
      writeSemaphore,
      entryPrefix: albumId,
    });
    logger.info("album export finished", {
      albumId,
      concurrency,
      imageFormat,
      chapterCount: summary.chapterCount,
      pageCount: summary.pageCount,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error?.("album export failed", {
      albumId,
      concurrency,
      imageFormat,
      durationMs: Date.now() - startedAt,
      error: getErrorMessage(error),
    });
    throw error;
  } finally {
    await writer.close();
  }
}

export async function exportFavoritesToZip(options: ExportFavoritesToZipOptions): Promise<void> {
  const { jmClient, zipPath, folderId, orderBy, imageFormat } = options;
  const logger = options.logger ?? DEFAULT_LOGGER;
  const concurrency = normalizeConcurrency(options.concurrency);
  const startedAt = Date.now();

  const writer = await ZipStoreWriter.open(zipPath);
  const downloadSemaphore = new Semaphore(concurrency);
  const writeSemaphore = new Semaphore(1);

  try {
    logger.info("favorites export started", {
      folderId,
      orderBy,
      concurrency,
      imageFormat,
      zipPath,
    });
    const albums = await fetchFavoriteAlbums(jmClient, { folderId, orderBy });
    let totalChapterCount = 0;
    let totalPageCount = 0;

    for (const album of albums) {
      const summary = await exportAlbumToWriter({
        jmClient,
        albumId: album.albumId,
        imageFormat,
        writer,
        downloadSemaphore,
        writeSemaphore,
        entryPrefix: `albums/${album.albumId}`,
      });
      totalChapterCount += summary.chapterCount;
      totalPageCount += summary.pageCount;
    }
    logger.info("favorites export finished", {
      folderId,
      orderBy,
      albumCount: albums.length,
      chapterCount: totalChapterCount,
      pageCount: totalPageCount,
      concurrency,
      imageFormat,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error?.("favorites export failed", {
      folderId,
      orderBy,
      concurrency,
      imageFormat,
      durationMs: Date.now() - startedAt,
      error: getErrorMessage(error),
    });
    throw error;
  } finally {
    await writer.close();
  }
}

async function exportAlbumToWriter(options: {
  jmClient: ExportAlbumToZipOptions["jmClient"];
  albumId: string;
  chapterIds?: string[];
  imageFormat: ExportAlbumToZipOptions["imageFormat"];
  writer: Pick<ZipStoreWriter, "addFile">;
  downloadSemaphore: Semaphore;
  writeSemaphore: Semaphore;
  entryPrefix: string;
}): Promise<{ chapterCount: number; pageCount: number }> {
  const { jmClient, albumId, chapterIds, imageFormat, writer, downloadSemaphore, writeSemaphore, entryPrefix } = options;

  const albumResponse = await jmClient.fetchAlbumDetail(albumId);
  const chapters = filterAlbumChapters(normalizeAlbumChapters(albumResponse.data, albumId), chapterIds);

  const tasks: Array<Promise<void>> = [];
  let pageCount = 0;

  for (const { chapterId, chapterSort } of chapters) {
    const [chapterResponse, scrambleId] = await Promise.all([jmClient.fetchChapterDetail(chapterId), jmClient.fetchScrambleId(chapterId)]);

    const pageFiles = normalizeChapterImages(chapterResponse.data);
    pageCount += pageFiles.length;

    for (const pageFile of pageFiles) {
      tasks.push(
        downloadSemaphore.run(async () => {
          const { name: baseName } = splitFileName(pageFile);
          const imageUrl = jmClient.buildImageUrl(chapterId, pageFile);

          const response = await jmClient.fetchImageResponse(imageUrl);
          const rawBytes = new Uint8Array(await response.arrayBuffer());

          const outputFormat =
            imageFormat === "original" ? inferOutputFormat(response.headers.get("content-type"), rawBytes) : imageFormat;
          const decrypted = await jmClient.decryptImage(rawBytes, {
            aid: chapterId,
            scramble_id: scrambleId,
            img_file_name: baseName,
            format: outputFormat,
          });

          const pageFileName = `${baseName}${outputFormat === "jpeg" ? ".jpg" : ".webp"}`;
          const entryName = `${entryPrefix}/${chapterSort}-${chapterId}/${pageFileName}`;

          await writeSemaphore.run(() => writer.addFile(entryName, decrypted.data));
        }),
      );
    }
  }

  await Promise.all(tasks);
  return {
    chapterCount: chapters.length,
    pageCount,
  };
}

function filterAlbumChapters(chapters: AlbumChapter[], chapterIds?: string[]) {
  if (!chapterIds || chapterIds.length === 0) {
    return chapters;
  }

  const selected = new Set(chapterIds);
  return chapters.filter((chapter) => selected.has(chapter.chapterId));
}

async function fetchFavoriteAlbums(
  jmClient: Pick<JMComicClient, "requestApi">,
  options: { folderId: string; orderBy: string },
): Promise<FavoriteAlbum[]> {
  const pageStart = 1;
  const maxPages = 1000;
  const seen = new Set<string>();
  const albums: FavoriteAlbum[] = [];

  for (let page = pageStart; page <= maxPages; page += 1) {
    const response = await jmClient.requestApi(JMComicClient.API_FAVORITE, {
      params: {
        page,
        folder_id: options.folderId,
        o: options.orderBy,
      },
    });

    const model = ensureRecord(response.data, "favorites");
    const rawList = getRecordArray(model["list"]);

    if (rawList.length === 0) {
      break;
    }

    for (const item of rawList) {
      const albumId = getString(item["id"]);
      if (!albumId) continue;
      if (seen.has(albumId)) continue;
      seen.add(albumId);
      albums.push({ albumId, name: getString(item["name"]) });
    }
  }

  return albums;
}

function normalizeAlbumChapters(albumData: unknown, albumId: string): AlbumChapter[] {
  const record = ensureRecord(albumData, "albumDetail");
  const series = getRecordArray(record["series"]);

  if (series.length === 0) {
    return [{ chapterId: albumId, chapterSort: "1" }];
  }

  return series.map((item) => ({
    chapterId: getString(item["id"], albumId),
    chapterSort: getString(item["sort"], "1"),
  }));
}

function normalizeChapterImages(chapterData: unknown): string[] {
  const record = ensureRecord(chapterData, "chapterDetail");
  return normalizeStringList(record["images"]);
}

function inferOutputFormat(contentType: string | null, bytes: Uint8Array): JmImageOutputFormat {
  const ct = contentType?.toLowerCase() ?? "";
  if (ct.includes("image/jpeg") || ct.includes("image/jpg") || ct.includes("jpeg") || ct.includes("jpg")) return "jpeg";
  if (ct.includes("image/webp") || ct.includes("webp")) return "webp";

  // Magic bytes fallback.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "webp";
  }

  // Default to webp to keep output small.
  return "webp";
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

function normalizeConcurrency(concurrency?: number): number {
  return Math.max(1, Math.floor(concurrency ?? DEFAULT_EXPORT_CONCURRENCY));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
