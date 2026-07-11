import assert from "node:assert/strict";
import test from "node:test";

import { hasRequestCookie } from "./request-cookie";

test("hasRequestCookie returns true when target cookie exists", () => {
  assert.equal(
    hasRequestCookie("aura_session=abc123; theme=dark", "aura_session"),
    true,
  );
});

test("hasRequestCookie returns false for missing or malformed cookies", () => {
  assert.equal(hasRequestCookie(null, "aura_session"), false);
  assert.equal(hasRequestCookie("theme=dark; foo=bar", "aura_session"), false);
  assert.equal(hasRequestCookie("invalid-cookie", "aura_session"), false);
});

test("hasRequestCookie only matches exact cookie names", () => {
  assert.equal(
    hasRequestCookie("aura_session_backup=1; theme=dark", "aura_session"),
    false,
  );
});
