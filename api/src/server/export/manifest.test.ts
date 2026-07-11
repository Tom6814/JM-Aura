import test from "node:test";
import assert from "node:assert/strict";

import { fetchAlbumManifest } from "./manifest";

test("fetchAlbumManifest: returns chapters/pages and proxy URLs include /api/image/proxy?url=", async () => {
  const jmClient = {
    fetchAlbumDetail: async () => ({
      data: {
        // Intentionally unsorted by sort to verify stable sorting.
        series: [
          { id: "c2", sort: "2", name: "ch2" },
          { id: "c1", sort: "1", name: "ch1" },
        ],
      },
    }),
    fetchChapterDetail: async (chapterId: string) => ({
      data: {
        images: chapterId === "c1" ? ["00001.webp", "00002.webp"] : ["00003.webp"],
      },
    }),
    fetchScrambleId: async (chapterId: string) => (chapterId === "c1" ? "220980" : "220981"),
    buildImageUrl: (chapterId: string, fileName: string) => `https://img.example/${chapterId}/${fileName}`,
  };

  const manifest = await fetchAlbumManifest({
    jmClient: jmClient as any,
    albumId: "a1",
    origin: "http://localhost",
  });

  assert.equal(manifest.albumId, "a1");
  assert.equal(manifest.chapters.length, 2);

  // Sorted by numeric sort ascending.
  assert.deepEqual(
    manifest.chapters.map((c) => c.chapterId),
    ["c1", "c2"],
  );

  assert.deepEqual(
    manifest.chapters[0]?.pages.map((p) => p.fileName),
    ["00001.webp", "00002.webp"],
  );

  const firstUrl = manifest.chapters[0]?.pages[0]?.proxyUrl ?? "";
  assert.ok(firstUrl.includes("/api/image/proxy?url="));
  assert.ok(firstUrl.includes("url=https%3A%2F%2Fimg.example%2Fc1%2F00001.webp"));
  assert.ok(firstUrl.includes("scramble_id=220980"));
  assert.ok(firstUrl.includes("aid=c1"));
  assert.ok(firstUrl.includes("img_file_name=00001"));
  assert.ok(firstUrl.includes("format=original"));
});
