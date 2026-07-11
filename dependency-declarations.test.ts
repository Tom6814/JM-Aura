import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";

test("package.json declares direct runtime and test imports used by the codebase", async () => {
  const pkg = JSON.parse(await fs.readFile(new URL("./package.json", import.meta.url), "utf8"));
  const dependencies = pkg.dependencies ?? {};
  const devDependencies = pkg.devDependencies ?? {};

  assert.ok(dependencies.undici, "undici should be declared because api/src/server/jmClient.ts imports it directly");
  assert.ok(
    devDependencies["react-router-dom"] || dependencies["react-router-dom"],
    "react-router-dom should be declared because web tests import it directly",
  );
});
