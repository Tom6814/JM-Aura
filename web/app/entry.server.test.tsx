import assert from "node:assert/strict";
import test from "node:test";

test("entry server gives deferred reader routes enough time before aborting suspense", async () => {
  const module = await import("./entry.server");

  assert.equal(module.ABORT_DELAY_MS, 30_000);
});
