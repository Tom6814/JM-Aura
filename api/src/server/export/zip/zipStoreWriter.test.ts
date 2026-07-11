import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZipStoreWriter } from "./zipStoreWriter";

test("zip writer produces a readable zip file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jm-zip-"));
  const zipPath = path.join(dir, "out.zip");
  const writer = await ZipStoreWriter.open(zipPath);
  await writer.addFile("a.txt", Buffer.from("hello"));
  await writer.addFile("b/b.txt", Buffer.from("world"));
  await writer.close();

  const stat = await fs.stat(zipPath);
  assert.ok(stat.size > 50);

  // Extra sanity checks: basic ZIP signatures & central directory counts.
  const data = await fs.readFile(zipPath);
  assert.equal(data.readUInt32LE(0), 0x04034b50);
  // We always write end record without comment => fixed 22 bytes at EOF.
  assert.equal(data.readUInt32LE(data.length - 22), 0x06054b50);

  const totalEntries = data.readUInt16LE(data.length - 22 + 10);
  assert.equal(totalEntries, 2);

  const centralDirOffset = data.readUInt32LE(data.length - 22 + 16);
  assert.ok(centralDirOffset > 0);
  assert.equal(data.readUInt32LE(centralDirOffset), 0x02014b50);
});

