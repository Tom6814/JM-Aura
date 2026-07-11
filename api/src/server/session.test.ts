import test from "node:test";
import assert from "node:assert/strict";
import { JmSessionManager } from "./session";

test("session manager prefers x-jm-session header over cookie", () => {
  const sm = new JmSessionManager({ createClient: () => ({ id: crypto.randomUUID() } as any) });
  const req = new Request("http://localhost/", {
    headers: {
      cookie: "aura_session=cookie1",
      "x-jm-session": "header1",
    },
  });

  const ctx = sm.get(req);
  assert.equal(ctx.sessionId, "header1");
});

test("session manager returns same client for same session id", () => {
  let created = 0;
  const sm = new JmSessionManager({
    createClient: () => {
      created += 1;
      return ({ created } as any);
    },
  });

  const req1 = new Request("http://localhost/", { headers: { "x-jm-session": "s1" } });
  const req2 = new Request("http://localhost/", { headers: { "x-jm-session": "s1" } });

  const c1 = sm.get(req1).client;
  const c2 = sm.get(req2).client;
  assert.equal(c1, c2);
  assert.equal(created, 1);
});

test("session manager expires cookie sessions after TTL and issues a new session id", () => {
  let created = 0;
  let nowMs = 0;
  const sm = new JmSessionManager({
    ttlMs: 10,
    nowMs: () => nowMs,
    createClient: () => {
      created += 1;
      return ({ created } as any);
    },
  });

  const req = new Request("http://localhost/", { headers: { cookie: "aura_session=s-cookie" } });

  const c1 = sm.get(req);
  assert.equal(c1.sessionId, "s-cookie");
  assert.equal(c1.isNew, true);

  nowMs = 5;
  const c2 = sm.get(req);
  assert.equal(c2.sessionId, "s-cookie");
  assert.equal(c2.isNew, false);
  assert.equal(c2.client, c1.client);
  assert.equal(created, 1);

  nowMs = 16;
  const c3 = sm.get(req);
  assert.notEqual(c3.sessionId, "s-cookie");
  assert.equal(c3.isNew, true);
  assert.notEqual(c3.client, c1.client);
  assert.equal(created, 2);
});

test("session manager calls onSessionExpired before rotating cookie session", () => {
  const expired: string[] = [];
  let nowMs = 0;
  const manager = new JmSessionManager({
    ttlMs: 10,
    nowMs: () => nowMs,
    createClient: () => ({ marker: "client" } as any),
    onSessionExpired(sessionId) {
      expired.push(sessionId);
    },
  });

  const req = new Request("http://localhost", { headers: { cookie: "aura_session=s1" } });

  manager.get(req);
  nowMs = 11;
  manager.get(req);

  assert.deepEqual(expired, ["s1"]);
});
