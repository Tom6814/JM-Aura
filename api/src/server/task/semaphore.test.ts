import test from "node:test";
import assert from "node:assert/strict";
import { Semaphore } from "./semaphore";

test("semaphore limits concurrency", async () => {
  const sem = new Semaphore(1);
  const events: string[] = [];

  const a = sem.run(async () => {
    events.push("a:start");
    await new Promise((r) => setTimeout(r, 50));
    events.push("a:end");
  });

  const b = sem.run(async () => {
    events.push("b:start");
    events.push("b:end");
  });

  await Promise.all([a, b]);
  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});

