import test from "node:test";
import assert from "node:assert/strict";

import { ZipStoreWriter } from "./zip/zipStoreWriter";
import { exportFavoritesToZip } from "./zipExporter";

type AddFileCall = { name: string; bytes: Uint8Array };

function makeMockZipWriter() {
  const calls: AddFileCall[] = [];
  const writer = {
    addFile: async (name: string, bytes: Uint8Array) => {
      calls.push({ name, bytes });
    },
    close: async () => {},
  };
  return { writer, calls };
}

test("exportFavoritesToZip: paginates favorites and writes multiple albums into a single zip with album prefixes", async () => {
  const { writer, calls } = makeMockZipWriter();

  const originalOpen = ZipStoreWriter.open;
  (ZipStoreWriter as any).open = async () => writer;

  try {
    const requestApiCalls: any[] = [];
    const jmClient = {
      requestApi: async (_path: string, options: any) => {
        requestApiCalls.push(options);
        const page = Number(options?.params?.page ?? 1);
        if (page === 1) {
          return { data: { list: [{ id: "a1", name: "album1" }] } };
        }
        if (page === 2) {
          return { data: { list: [{ id: "a2", name: "album2" }] } };
        }
        return { data: { list: [] } };
      },
      fetchAlbumDetail: async () => ({
        data: {
          // no series => treat album itself as single chapter
          series: [],
        },
      }),
      fetchChapterDetail: async () => ({ data: { images: ["00001.webp"] } }),
      fetchScrambleId: async () => "220980",
      buildImageUrl: (photoId: string, fileName: string) => `http://image/${photoId}/${fileName}`,
      fetchImageResponse: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } }),
      decryptImage: async () => ({ data: new Uint8Array([9]) }),
    };

    await exportFavoritesToZip({
      jmClient: jmClient as any,
      zipPath: "/tmp/ignored.zip",
      folderId: "0",
      orderBy: "mr",
      imageFormat: "webp",
      concurrency: 2,
    });

    assert.ok(requestApiCalls.length >= 2);

    const names = calls.map((c) => c.name);
    assert.ok(names.some((name) => name.startsWith("albums/a1/")), `expected at least one entry under albums/a1/, got: ${names.join(", ")}`);
    assert.ok(names.some((name) => name.startsWith("albums/a2/")), `expected at least one entry under albums/a2/, got: ${names.join(", ")}`);
  } finally {
    (ZipStoreWriter as any).open = originalOpen;
  }
});

