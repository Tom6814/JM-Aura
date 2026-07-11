import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ExportStore } from "./exportStore";

test("export store builds deterministic path", () => {
  const store = new ExportStore({ rootDir: ".cache/exports", ttlMs: 2 * 60 * 60 * 1000 });
  assert.match(store.getZipPath("t1"), /\.cache\/exports\/t1\.zip$/);
});

test("isExpired uses ttl and supports virtual nowMs", () => {
  const store = new ExportStore({ ttlMs: 1000 });
  assert.equal(store.isExpired(0, 999), false);
  assert.equal(store.isExpired(0, 1000), true);
  assert.equal(store.isExpired(500, 1499), false);
  assert.equal(store.isExpired(500, 1500), true);
});

test("cleanupOnce removes expired zip files under rootDir", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jm-export-store-"));
  try {
    const store = new ExportStore({ rootDir: dir, ttlMs: 1000 });
    await store.ensureRootDir();

    const expiredZip = path.join(dir, "expired.zip");
    const freshZip = path.join(dir, "fresh.zip");
    const ignoredTxt = path.join(dir, "ignored.txt");

    await Promise.all([
      fs.writeFile(expiredZip, "x"),
      fs.writeFile(freshZip, "y"),
      fs.writeFile(ignoredTxt, "z"),
    ]);

    // Set mtime for the expired file to 0ms epoch.
    await fs.utimes(expiredZip, new Date(0), new Date(0));

    const nowMs = 1000; // expires at mtime(0) + ttl(1000)
    const deleted = await store.cleanupOnce(nowMs);
    assert.equal(deleted, 1);

    await assert.rejects(() => fs.stat(expiredZip));
    await fs.stat(freshZip);
    await fs.stat(ignoredTxt);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("cleanupIfDue lazily schedules cleanup work", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jm-export-store-lazy-"));
  let nowMs = 1_000;
  try {
    const store = new ExportStore({
      rootDir: dir,
      ttlMs: 100,
      cleanupIntervalMs: 500,
      now: () => nowMs,
    });
    await store.ensureRootDir();

    const expiredZip1 = path.join(dir, "expired-1.zip");
    await fs.writeFile(expiredZip1, "x");
    await fs.utimes(expiredZip1, new Date(0), new Date(0));

    const deleted1 = await store.cleanupIfDue();
    assert.equal(deleted1, 1);
    await assert.rejects(() => fs.stat(expiredZip1));

    const expiredZip2 = path.join(dir, "expired-2.zip");
    await fs.writeFile(expiredZip2, "y");
    await fs.utimes(expiredZip2, new Date(0), new Date(0));

    nowMs = 1_200;
    const deleted2 = await store.cleanupIfDue();
    assert.equal(deleted2, 0);
    await fs.stat(expiredZip2);

    nowMs = 1_600;
    const deleted3 = await store.cleanupIfDue();
    assert.equal(deleted3, 1);
    await assert.rejects(() => fs.stat(expiredZip2));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("export store deletes an existing zip path safely", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jm-export-store-delete-"));
  try {
    const store = new ExportStore({ rootDir: dir });
    const filePath = path.join(dir, "a.zip");

    await fs.writeFile(filePath, Buffer.from("zip"));
    const deleted = await store.deleteZipIfExists(filePath);

    assert.equal(deleted, true);
    await assert.rejects(() => fs.stat(filePath));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
