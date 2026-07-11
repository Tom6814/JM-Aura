import assert from "node:assert/strict";
import test from "node:test";

import { getEffectiveLoginSyncState, type LoginSyncState } from "./profile";

test("getEffectiveLoginSyncState returns null after incoming sync has been handled", () => {
  const incoming: LoginSyncState = {
    phase: "waiting",
    message: "登录成功，2 秒后刷新工作区状态。",
    completedAtMs: 123,
  };

  assert.equal(
    getEffectiveLoginSyncState({ active: null, incoming, handledAtMs: 123 }),
    null,
  );
});

test("getEffectiveLoginSyncState returns incoming when not handled yet", () => {
  const incoming: LoginSyncState = {
    phase: "waiting",
    message: "登录成功，2 秒后刷新工作区状态。",
    completedAtMs: 123,
  };

  assert.deepEqual(
    getEffectiveLoginSyncState({ active: null, incoming, handledAtMs: null }),
    incoming,
  );
});

