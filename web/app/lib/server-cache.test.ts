import assert from "node:assert/strict";
import test from "node:test";

import { readThroughServerCache } from "./server-cache";

test("readThroughServerCache reuses cached values within ttl", async () => {
  let calls = 0;

  const first = await readThroughServerCache("home:test", 1_000, async () => {
    calls += 1;
    return { value: "cached" };
  });

  const second = await readThroughServerCache("home:test", 1_000, async () => {
    calls += 1;
    return { value: "fresh" };
  });

  assert.deepEqual(first, { value: "cached" });
  assert.deepEqual(second, { value: "cached" });
  assert.equal(calls, 1);
});

test("readThroughServerCache shares in-flight requests for same key", async () => {
  let calls = 0;

  const [first, second] = await Promise.all([
    readThroughServerCache("discover:test", 1_000, async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "resolved";
    }),
    readThroughServerCache("discover:test", 1_000, async () => {
      calls += 1;
      return "duplicate";
    }),
  ]);

  assert.equal(first, "resolved");
  assert.equal(second, "resolved");
  assert.equal(calls, 1);
});

test("readThroughServerCache does not cache rejected loaders", async () => {
  let calls = 0;

  await assert.rejects(() =>
    readThroughServerCache("home:error", 1_000, async () => {
      calls += 1;
      throw new Error("boom");
    }),
  );

  await assert.rejects(() =>
    readThroughServerCache("home:error", 1_000, async () => {
      calls += 1;
      throw new Error("boom");
    }),
  );

  assert.equal(calls, 2);
});
