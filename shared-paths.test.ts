import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = new URL(".", import.meta.url);
const TARGET_DIRECTORIES = ["web/app", "cli", "api/src/server", "web", "api", "packages/shared"] as const;
const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);

async function collectFiles(directory: string): Promise<string[]> {
  const absoluteDirectory = new URL(directory, REPO_ROOT);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.posix.join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectFiles(relativePath);
      }

      if (!SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
        return [];
      }

      return [relativePath];
    }),
  );

  return files.flat();
}

test("shared schema now lives under packages/shared/src", async () => {
  await access(new URL("./packages/shared/src/schema.ts", REPO_ROOT));
});

test("frontend app source now lives under web/app", async () => {
  await access(new URL("./web/app/root.tsx", REPO_ROOT));
});

test("backend source now lives under api/src/server", async () => {
  await access(new URL("./api/src/server/index.ts", REPO_ROOT));
});

test("legacy root app directory is removed from the active workspace", async () => {
  await assert.rejects(access(new URL("./app/root.tsx", REPO_ROOT)));
});

test("legacy root src/server directory is removed from the active workspace", async () => {
  await assert.rejects(access(new URL("./src/server/index.ts", REPO_ROOT)));
});

test("codebase no longer references root src/shared paths in active packages", async () => {
  const files = (await Promise.all(TARGET_DIRECTORIES.map((directory) => collectFiles(directory)))).flat();
  const offenders: string[] = [];

  for (const file of files) {
    const content = await readFile(new URL(file, REPO_ROOT), "utf8");

    if (content.includes("src/shared")) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});

test("active packages no longer reference the legacy root src/server directory", async () => {
  const files = (await Promise.all(TARGET_DIRECTORIES.map((directory) => collectFiles(directory)))).flat();
  const offenders: string[] = [];
  const legacyRootServerPatterns = ["./src/server", "../src/server", "../../src/server", "../../../src/server", "../../../../src/server"];

  for (const file of files) {
    const content = await readFile(new URL(file, REPO_ROOT), "utf8");

    if (legacyRootServerPatterns.some((pattern) => content.includes(pattern))) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});

test("active packages no longer reference the legacy root app directory", async () => {
  const files = (await Promise.all(TARGET_DIRECTORIES.map((directory) => collectFiles(directory)))).flat();
  const offenders: string[] = [];
  const legacyRootAppPatterns = ["../app", "../../app", "../../../app"];

  for (const file of files) {
    const content = await readFile(new URL(file, REPO_ROOT), "utf8");

    if (legacyRootAppPatterns.some((pattern) => content.includes(pattern))) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});
