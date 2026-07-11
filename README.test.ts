import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";

test("README includes v3.0.0 and JM-Aura comparison sections", async () => {
  const content = await fs.readFile(new URL("./README.md", import.meta.url), "utf8");

  assert.match(content, /v3\.0\.0/);
  assert.match(content, /JM-Aura/);
  assert.match(content, /Zeabur/);
  assert.match(content, /Quick Start|快速开始/);
  assert.match(content, /zeabur\.yaml/);
  assert.match(content, /web\/Dockerfile/);
  assert.match(content, /api\/Dockerfile/);
  assert.match(content, /web\/app/);
  assert.match(content, /api\/src\/server/);
  assert.doesNotMatch(content, /Dockerfile\.web/);
  assert.doesNotMatch(content, /Dockerfile\.api/);
  assert.doesNotMatch(content, /(^|[^a-z])app\/src\/server([^a-z]|$)/i);
});

test("deployment docs use monorepo dockerfile and service paths", async () => {
  const content = await fs.readFile(new URL("./docs/deployment/zeabur.md", import.meta.url), "utf8");

  assert.match(content, /zeabur\.yaml/);
  assert.match(content, /web\/Dockerfile/);
  assert.match(content, /api\/Dockerfile/);
  assert.match(content, /web\/app/);
  assert.match(content, /api\/src\/server/);
  assert.doesNotMatch(content, /Dockerfile\.web/);
  assert.doesNotMatch(content, /Dockerfile\.api/);
});

test("zeabur config uses official template format for web and api services", async () => {
  const content = await fs.readFile(new URL("./zeabur.yaml", import.meta.url), "utf8");

  assert.match(content, /^apiVersion:\s+zeabur\.com\/v1/m);
  assert.match(content, /^kind:\s+Template/m);
  assert.match(content, /template:\s+GIT/);
  assert.match(content, /repo:\s+1149811888/);
  assert.match(content, /branch:\s+v3\.0\.0-monorepo/);
  assert.match(content, /rootDirectory:\s+web/);
  assert.match(content, /rootDirectory:\s+api/);
  assert.doesNotMatch(content, /^services:\s*$/m);
});
