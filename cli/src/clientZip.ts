import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";

import type { HttpClient } from "./http";
import { Semaphore } from "../../api/src/server/task/semaphore";
import { ZipStoreWriter } from "../../api/src/server/export/zip/zipStoreWriter";
import { favoritesResultSchema } from "../../packages/shared/src/schema";

const manifestSchema = z
  .object({
    albumId: z.string().min(1),
    chapters: z.array(
      z
        .object({
          chapterId: z.string().min(1),
          sort: z.string().min(1),
          pages: z.array(
            z
              .object({
                fileName: z.string().min(1),
                proxyUrl: z.string().url(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export type ClientZipImageFormat = "original" | "webp" | "jpeg";

export async function exportAlbumAsClientZip(options: {
  client: HttpClient;
  albumId: string;
  outDir: string;
  imageFormat: ClientZipImageFormat;
  concurrency: number;
}): Promise<string> {
  const { client, albumId, outDir, imageFormat } = options;
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const outPath = path.resolve(outDir, fileNameForAlbum(albumId, imageFormat));
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const manifest = await client.getJson(`/api/export/album/${albumId}/manifest?format=${imageFormat}`, manifestSchema);
  const writer = await ZipStoreWriter.open(outPath);
  const downloadSem = new Semaphore(concurrency);
  const writeSem = new Semaphore(1);

  try {
    const tasks: Array<Promise<void>> = [];
    for (const chapter of manifest.chapters) {
      for (const page of chapter.pages) {
        tasks.push(
          downloadSem.run(async () => {
            const { bytes, contentType } = await client.fetchBinaryAbsolute(page.proxyUrl, { retries: 2, timeoutMs: 30_000 });
            const baseName = stripExtension(page.fileName);
            const outputExt = chooseExtension(imageFormat, contentType);
            const entryName = `${albumId}/${chapter.sort}-${chapter.chapterId}/${baseName}${outputExt}`;
            await writeSem.run(() => writer.addFile(entryName, Buffer.from(bytes)));
          }),
        );
      }
    }
    await Promise.all(tasks);
  } finally {
    await writer.close();
  }

  return outPath;
}

export async function exportFavoritesAsClientZip(options: {
  client: HttpClient;
  outDir: string;
  folderId: string;
  orderBy: string;
  imageFormat: ClientZipImageFormat;
  concurrency: number;
}): Promise<string> {
  const { client, outDir, folderId, orderBy, imageFormat } = options;
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const outPath = path.resolve(outDir, fileNameForFavorites(folderId, orderBy, imageFormat));
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const favorites = await fetchAllFavorites(client, { folderId, orderBy });
  const writer = await ZipStoreWriter.open(outPath);
  const downloadSem = new Semaphore(concurrency);
  const writeSem = new Semaphore(1);

  try {
    for (const item of favorites) {
      const albumId = item.id;
      const manifest = await client.getJson(`/api/export/album/${albumId}/manifest?format=${imageFormat}`, manifestSchema);
      const tasks: Array<Promise<void>> = [];
      for (const chapter of manifest.chapters) {
        for (const page of chapter.pages) {
          tasks.push(
            downloadSem.run(async () => {
              const { bytes, contentType } = await client.fetchBinaryAbsolute(page.proxyUrl, { retries: 2, timeoutMs: 30_000 });
              const baseName = stripExtension(page.fileName);
              const outputExt = chooseExtension(imageFormat, contentType);
              const entryName = `albums/${albumId}/${chapter.sort}-${chapter.chapterId}/${baseName}${outputExt}`;
              await writeSem.run(() => writer.addFile(entryName, Buffer.from(bytes)));
            }),
          );
        }
      }
      await Promise.all(tasks);
    }
  } finally {
    await writer.close();
  }

  return outPath;
}

async function fetchAllFavorites(client: HttpClient, options: { folderId: string; orderBy: string }) {
  const pageStart = 1;
  const maxPages = 1000;
  const seen = new Set<string>();
  const out: z.infer<typeof favoritesResultSchema>["list"] = [];

  for (let page = pageStart; page <= maxPages; page += 1) {
    const result = await client.getJson(
      `/api/favorites?page=${page}&folder_id=${encodeURIComponent(options.folderId)}&order_by=${encodeURIComponent(options.orderBy)}`,
      favoritesResultSchema,
    );

    if (result.list.length === 0) break;
    for (const item of result.list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }

  return out;
}

function fileNameForAlbum(albumId: string, imageFormat: ClientZipImageFormat) {
  return imageFormat === "original" ? `album-${albumId}.zip` : `album-${albumId}-${imageFormat}.zip`;
}

function fileNameForFavorites(folderId: string, orderBy: string, imageFormat: ClientZipImageFormat) {
  const suffix = imageFormat === "original" ? "" : `-${imageFormat}`;
  return `favorites-folder${folderId}-${orderBy}${suffix}.zip`;
}

function stripExtension(fileName: string) {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(0, idx) : fileName;
}

function chooseExtension(imageFormat: ClientZipImageFormat, contentType: string) {
  if (imageFormat === "jpeg") return ".jpg";
  if (imageFormat === "webp") return ".webp";
  // original: infer from actual response content-type.
  return contentType.includes("jpeg") ? ".jpg" : ".webp";
}
