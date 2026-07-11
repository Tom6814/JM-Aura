import test from "node:test";
import assert from "node:assert/strict";
import { TaskManager } from "./taskManager";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

test("task transitions queued -> running -> succeeded", async () => {
  const tm = new TaskManager({ concurrency: 1 });
  const task = tm.create("export_album_zip", "session-a", async (ctx) => {
    ctx.setTotal(2);
    ctx.tick("a");
    ctx.tick("b");
    return { filePath: "/tmp/fake.zip", fileName: "fake.zip", size: 123 };
  });

  assert.equal(task.sessionId, "session-a");
  assert.equal(tm.get(task.id)?.status, "queued");
  await tm.run(task.id);
  assert.equal(tm.get(task.id)?.status, "succeeded");
  assert.equal(tm.get(task.id)?.result?.fileName, "fake.zip");
});

test("cancel marks task canceled", async () => {
  const tm = new TaskManager({ concurrency: 1 });
  const task = tm.create("export_album_zip", "session-a", async (ctx) => {
    ctx.setTotal(1);
    await new Promise((r) => setTimeout(r, 100));
    ctx.tick("done");
    return { filePath: "/tmp/fake.zip", fileName: "fake.zip", size: 1 };
  });

  const runPromise = tm.run(task.id);
  tm.cancel(task.id);
  await runPromise.catch(() => null);
  assert.equal(tm.get(task.id)?.status, "canceled");
});

test("task retries retryable runner errors once and then succeeds", async () => {
  const tm = new TaskManager({ concurrency: 1 });
  let attempts = 0;
  const task = tm.create(
    "export_album_zip",
    "session-a",
    async () => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error("network timeout");
        (err as Error & { code?: string }).code = "ETIMEDOUT";
        throw err;
      }
      return { filePath: "/tmp/fake.zip", fileName: "fake.zip", size: 123 };
    },
    {
      retry: {
        maxAttempts: 2,
      },
    },
  );

  await tm.run(task.id);
  assert.equal(tm.get(task.id)?.status, "succeeded");
  assert.equal(attempts, 2);
});

test("task does not retry auth errors", async () => {
  const tm = new TaskManager({ concurrency: 1 });
  let attempts = 0;
  const task = tm.create(
    "export_album_zip",
    "session-a",
    async () => {
      attempts += 1;
      const err = new Error("Unauthorized");
      (err as Error & { status?: number }).status = 401;
      throw err;
    },
    {
      retry: {
        maxAttempts: 3,
      },
    },
  );

  await assert.rejects(() => tm.run(task.id), /Unauthorized/);
  assert.equal(tm.get(task.id)?.status, "failed");
  assert.equal(attempts, 1);
});

test("task fails after attempt timeout", async () => {
  const tm = new TaskManager({ concurrency: 1 });
  let attempts = 0;
  const task = tm.create(
    "export_album_zip",
    "session-a",
    async () => {
      attempts += 1;
      await sleep(30);
      return { filePath: "/tmp/fake.zip", fileName: "fake.zip", size: 123 };
    },
    {
      retry: {
        maxAttempts: 1,
        timeoutMs: 10,
      },
    },
  );

  await assert.rejects(() => tm.run(task.id), /timed out/i);
  assert.equal(tm.get(task.id)?.status, "failed");
  assert.equal(attempts, 1);
});

test("listBySession only returns tasks from the requested session in reverse creation order", () => {
  let now = 100;
  const tm = new TaskManager({ concurrency: 1, now: () => now++ });

  const taskA1 = tm.create("export_album_zip", "session-a", async () => ({
    filePath: "/tmp/a-1.zip",
    fileName: "a-1.zip",
    size: 1,
  }));
  const taskB1 = tm.create("export_favorites_zip", "session-b", async () => ({
    filePath: "/tmp/b-1.zip",
    fileName: "b-1.zip",
    size: 2,
  }));
  const taskA2 = tm.create("export_album_zip", "session-a", async () => ({
    filePath: "/tmp/a-2.zip",
    fileName: "a-2.zip",
    size: 3,
  }));

  assert.deepEqual(
    tm.listBySession("session-a").map((task) => task.id),
    [taskA2.id, taskA1.id],
  );
  assert.deepEqual(
    tm.listBySession("session-a", { limit: 1 }).map((task) => task.id),
    [taskA2.id],
  );
  assert.deepEqual(tm.listBySession("session-b").map((task) => task.id), [taskB1.id]);
});

test("getOwnedTask only returns tasks owned by the session", () => {
  const tm = new TaskManager({ concurrency: 1 });
  const owned = tm.create("export_album_zip", "session-a", async () => ({
    filePath: "/tmp/a.zip",
    fileName: "a.zip",
    size: 1,
  }));
  const foreign = tm.create("export_album_zip", "session-b", async () => ({
    filePath: "/tmp/b.zip",
    fileName: "b.zip",
    size: 1,
  }));

  assert.equal(tm.getOwnedTask("session-a", owned.id)?.id, owned.id);
  assert.equal(tm.getOwnedTask("session-a", foreign.id), undefined);
  assert.equal(tm.getOwnedTask("missing-session", owned.id), undefined);
});

test("deleteOwnedTask only deletes tasks owned by the session", () => {
  const tm = new TaskManager({ concurrency: 1 });
  const owned = tm.create("export_album_zip", "session-a", async () => ({
    filePath: "/tmp/a.zip",
    fileName: "a.zip",
    size: 1,
  }));
  const foreign = tm.create("export_album_zip", "session-b", async () => ({
    filePath: "/tmp/b.zip",
    fileName: "b.zip",
    size: 1,
  }));

  assert.equal(tm.deleteOwnedTask("session-a", foreign.id), false);
  assert.notEqual(tm.get(foreign.id), undefined);

  assert.equal(tm.deleteOwnedTask("session-a", owned.id), true);
  assert.equal(tm.get(owned.id), undefined);
});

test("deleteBySession removes all tasks for the session and returns deleted count", () => {
  const tm = new TaskManager({ concurrency: 1 });
  const taskA1 = tm.create("export_album_zip", "session-a", async () => ({
    filePath: "/tmp/a-1.zip",
    fileName: "a-1.zip",
    size: 1,
  }));
  const taskA2 = tm.create("export_favorites_zip", "session-a", async () => ({
    filePath: "/tmp/a-2.zip",
    fileName: "a-2.zip",
    size: 2,
  }));
  const taskB1 = tm.create("export_album_zip", "session-b", async () => ({
    filePath: "/tmp/b-1.zip",
    fileName: "b-1.zip",
    size: 3,
  }));

  assert.equal(tm.deleteBySession("session-a"), 2);
  assert.equal(tm.get(taskA1.id), undefined);
  assert.equal(tm.get(taskA2.id), undefined);
  assert.notEqual(tm.get(taskB1.id), undefined);
  assert.equal(tm.deleteBySession("session-a"), 0);
});
