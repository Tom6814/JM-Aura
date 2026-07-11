import assert from "node:assert/strict";
import test from "node:test";

import { getCommentMetaLabels } from "./comment-meta";

test("comment meta labels omit likes and only keep reply context", () => {
  assert.deepEqual(getCommentMetaLabels(null), []);
  assert.deepEqual(getCommentMetaLabels("42"), ["回复 42"]);
});

