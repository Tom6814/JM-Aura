import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(path: string) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("root package uses npm workspaces for web api and shared", async () => {
  const rootPkg = await readJson("./package.json");

  assert.deepEqual(rootPkg.workspaces, ["web", "api", "packages/*"]);
  assert.equal(rootPkg.private, true);
  assert.equal(rootPkg.scripts["dev:web"], "npm --workspace web run dev");
  assert.equal(rootPkg.scripts["dev:api"], "npm --workspace api run dev");
});

test("workspace package manifests and tsconfigs exist", async () => {
  for (const path of [
    "./Dockerfile.web",
    "./Dockerfile.api",
    "./zbpack.web.json",
    "./zbpack.api.json",
    "./web/app/root.tsx",
    "./web/package.json",
    "./web/remix.config.js",
    "./web/tsconfig.json",
    "./api/package.json",
    "./api/tsconfig.json",
    "./api/src/server/index.ts",
    "./packages/shared/package.json",
    "./packages/shared/tsconfig.json",
    "./tsconfig.base.json",
  ]) {
    const content = await readFile(new URL(path, import.meta.url), "utf8");
    assert.ok(content.length > 0, `${path} should not be empty`);
  }
});

test("web workspace scripts resolve frontend paths from inside web", async () => {
  const webPkg = await readJson("./web/package.json");

  assert.equal(webPkg.scripts.dev, "remix dev");
  assert.equal(webPkg.scripts.build, "remix build");
  assert.equal(webPkg.scripts.start, "remix-serve ./build/index.js");
  assert.equal(webPkg.scripts.test, 'node --import tsx --test "app/**/*.test.ts" "app/**/*.test.tsx"');
});

test("api workspace scripts resolve backend paths from inside api", async () => {
  const apiPkg = await readJson("./api/package.json");

  assert.equal(apiPkg.scripts.dev, "tsx src/server/dev.ts");
  assert.equal(apiPkg.scripts.start, "tsx src/server/dev.ts");
});
