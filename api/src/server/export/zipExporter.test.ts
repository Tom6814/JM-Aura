import test from "node:test";
import assert from "node:assert/strict";

import { ZipStoreWriter } from "./zip/zipStoreWriter";
import { exportAlbumToZip } from "./zipExporter";

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

test("exportAlbumToZip: uses fixed entry naming and honors imageFormat=jpeg", async () => {
  const { writer, calls } = makeMockZipWriter();

  const originalOpen = ZipStoreWriter.open;
  (ZipStoreWriter as any).open = async () => writer;
  try {
    const decryptFormats: Array<string | undefined> = [];
    const jmClient = {
      fetchAlbumDetail: async () => ({
        data: {
          series: [
            { id: "c1", sort: "1", name: "ch1" },
            { id: "c2", sort: "2", name: "ch2" },
          ],
        },
      }),
      fetchChapterDetail: async (photoId: string) => ({
        data: { images: photoId === "c1" ? ["00001.webp", "00002.webp"] : ["00003.webp"] },
      }),
      fetchScrambleId: async () => "220980",
      buildImageUrl: (photoId: string, fileName: string) => `http://image/${photoId}/${fileName}`,
      fetchImageResponse: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } }),
      decryptImage: async (_bytes: Uint8Array, ctx: any) => {
        decryptFormats.push(ctx.format);
        return { data: new Uint8Array([9, 9, 9]) };
      },
    };

    await exportAlbumToZip({
      jmClient: jmClient as any,
      albumId: "a1",
      zipPath: "/tmp/ignored.zip",
      imageFormat: "jpeg",
      concurrency: 3,
    });

    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.map((c) => c.name).sort(),
      ["a1/1-c1/00001.jpg", "a1/1-c1/00002.jpg", "a1/2-c2/00003.jpg"].sort(),
    );
    assert.ok(decryptFormats.every((f) => f === "jpeg"));
  } finally {
    (ZipStoreWriter as any).open = originalOpen;
  }
});

test("exportAlbumToZip: honors imageFormat=webp and produces .webp entries", async () => {
  const { writer, calls } = makeMockZipWriter();

  const originalOpen = ZipStoreWriter.open;
  (ZipStoreWriter as any).open = async () => writer;
  try {
    const decryptFormats: Array<string | undefined> = [];
    const jmClient = {
      fetchAlbumDetail: async () => ({
        data: {
          series: [{ id: "c1", sort: "7", name: "ch1" }],
        },
      }),
      fetchChapterDetail: async () => ({ data: { images: ["00001.jpg"] } }),
      fetchScrambleId: async () => "220980",
      buildImageUrl: (_photoId: string, fileName: string) => `http://image/c1/${fileName}`,
      fetchImageResponse: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
      decryptImage: async (_bytes: Uint8Array, ctx: any) => {
        decryptFormats.push(ctx.format);
        return { data: new Uint8Array([8, 8]) };
      },
    };

    await exportAlbumToZip({
      jmClient: jmClient as any,
      albumId: "a1",
      zipPath: "/tmp/ignored.zip",
      imageFormat: "webp",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, "a1/7-c1/00001.webp");
    assert.deepEqual(decryptFormats, ["webp"]);
  } finally {
    (ZipStoreWriter as any).open = originalOpen;
  }
});

test("exportAlbumToZip: imageFormat=original chooses output based on upstream content-type", async () => {
  const { writer, calls } = makeMockZipWriter();

  const originalOpen = ZipStoreWriter.open;
  (ZipStoreWriter as any).open = async () => writer;
  try {
    const decryptFormats: Array<string | undefined> = [];
    const jmClient = {
      fetchAlbumDetail: async () => ({
        data: { series: [{ id: "c1", sort: "1", name: "ch1" }] },
      }),
      fetchChapterDetail: async () => ({ data: { images: ["00001.webp", "00002.webp"] } }),
      fetchScrambleId: async () => "220980",
      buildImageUrl: (_photoId: string, fileName: string) => `http://image/c1/${fileName}`,
      fetchImageResponse: async (url: string) => {
        const isFirst = url.includes("00001");
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": isFirst ? "image/jpeg" : "image/webp" },
        });
      },
      decryptImage: async (_bytes: Uint8Array, ctx: any) => {
        decryptFormats.push(ctx.format);
        return { data: new Uint8Array([7]) };
      },
    };

    await exportAlbumToZip({
      jmClient: jmClient as any,
      albumId: "a1",
      zipPath: "/tmp/ignored.zip",
      imageFormat: "original",
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((c) => c.name).sort(),
      ["a1/1-c1/00001.jpg", "a1/1-c1/00002.webp"].sort(),
    );
    assert.deepEqual(decryptFormats.sort(), ["jpeg", "webp"].sort());
  } finally {
    (ZipStoreWriter as any).open = originalOpen;
  }
});

test("exportAlbumToZip: only exports selected chapters when chapterIds is provided", async () => {
  const { writer, calls } = makeMockZipWriter();

  const originalOpen = ZipStoreWriter.open;
  (ZipStoreWriter as any).open = async () => writer;
  try {
    const visitedChapterIds: string[] = [];
    const jmClient = {
      fetchAlbumDetail: async () => ({
        data: {
          series: [
            { id: "c1", sort: "1", name: "ch1" },
            { id: "c2", sort: "2", name: "ch2" },
            { id: "c3", sort: "3", name: "ch3" },
          ],
        },
      }),
      fetchChapterDetail: async (photoId: string) => {
        visitedChapterIds.push(photoId);
        return { data: { images: [`${photoId}-00001.webp`] } };
      },
      fetchScrambleId: async () => "220980",
      buildImageUrl: (photoId: string, fileName: string) => `http://image/${photoId}/${fileName}`,
      fetchImageResponse: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } }),
      decryptImage: async () => ({ data: new Uint8Array([6]) }),
    };

    await exportAlbumToZip({
      jmClient: jmClient as any,
      albumId: "a1",
      zipPath: "/tmp/ignored.zip",
      imageFormat: "webp",
      chapterIds: ["c3", "c1"],
    });

    assert.deepEqual(visitedChapterIds, ["c1", "c3"]);
    assert.deepEqual(
      calls.map((c) => c.name).sort(),
      ["a1/1-c1/c1-00001.webp", "a1/3-c3/c3-00001.webp"].sort(),
    );
  } finally {
    (ZipStoreWriter as any).open = originalOpen;
  }
});
