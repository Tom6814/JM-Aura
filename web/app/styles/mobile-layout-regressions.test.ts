import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const appCss = readFileSync(new URL("./app.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("./shell.css", import.meta.url), "utf8");

test("manga detail mobile layout does not offset the whole page to the left", () => {
  assert.doesNotMatch(appCss, /\.manga-detail-layout\s*\{[^}]*margin-inline:\s*-16px;/s);
});

test("mobile topbar hides the global search slot", () => {
  assert.match(
    shellCss,
    /@media\s*\(max-width:\s*959px\)\s*\{[\s\S]*?\.app-topbar__search\s*\{[\s\S]*?display:\s*none;/,
  );
});

test("mobile topbar keeps desktop nav hidden by default to avoid replacing the bottom bar flow", () => {
  assert.match(
    shellCss,
    /\.app-topbar__desktop-nav,\s*\.app-topbar__desktop-tools\s*\{[\s\S]*?display:\s*none;/,
  );
});

test("mobile bottom nav still keeps four equal columns including the profile entry", () => {
  assert.match(shellCss, /\.app-bottom-nav__row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
});
