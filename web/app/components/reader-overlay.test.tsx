import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReaderOverlay } from "./reader-overlay";

test("ReaderOverlay wraps caller-provided chrome in shared top and bottom overlay shells", () => {
  const markup = renderToStaticMarkup(
    <ReaderOverlay
      showChrome
      topBar={<div className="reader-overlay-test-top">顶部栏</div>}
      bottomBar={<div className="reader-overlay-test-bottom">底部栏</div>}
    />,
  );

  assert.match(markup, /class="reader-topbar"/);
  assert.match(markup, /class="reader-bottombar"/);
  assert.match(markup, /reader-overlay__inner reader-overlay__inner--stage reader-overlay__inner--top/);
  assert.match(markup, /reader-overlay__inner reader-overlay__inner--stage reader-overlay__inner--bottom/);
  assert.match(markup, /顶部栏/);
  assert.match(markup, /底部栏/);
  assert.ok(markup.indexOf("reader-topbar") < markup.indexOf("reader-bottombar"));
});

test("ReaderOverlay applies hidden modifiers without dropping the desktop stage wrappers", () => {
  const markup = renderToStaticMarkup(
    <ReaderOverlay
      showChrome={false}
      topBar={<div>顶部</div>}
      bottomBar={<div>底部</div>}
    />,
  );

  assert.match(markup, /reader-topbar reader-topbar--hidden/);
  assert.match(markup, /reader-bottombar reader-bottombar--hidden/);
  assert.match(markup, /reader-overlay__inner reader-overlay__inner--stage/);
});
