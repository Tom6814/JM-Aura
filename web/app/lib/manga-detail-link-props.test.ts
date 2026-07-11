import assert from "node:assert/strict";
import test from "node:test";

import { getMangaDetailQueryLinkProps } from "./manga-detail-link-props";

test("getMangaDetailQueryLinkProps keeps in-page detail navigation from resetting scroll", () => {
  assert.deepEqual(getMangaDetailQueryLinkProps(), {
    prefetch: "intent",
    preventScrollReset: true,
  });
});

