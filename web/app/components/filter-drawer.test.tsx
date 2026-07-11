import assert from "node:assert/strict";
import test from "node:test";

import { getFilterDrawerPortalTarget } from "./filter-drawer";

test("getFilterDrawerPortalTarget resolves to document.body when available", () => {
  const fakeBody = { nodeName: "BODY" };
  const target = getFilterDrawerPortalTarget({ body: fakeBody } as { body: unknown });

  assert.equal(target, fakeBody);
});
