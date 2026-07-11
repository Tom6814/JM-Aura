import assert from "node:assert/strict";
import test from "node:test";

import {
  clampSupportingCopy,
  getCompactCardColumns,
  getDesktopLayoutMode,
  getMobileGridColumns,
  normalizeDrawerSectionState,
} from "./compact-layout";

test("clampSupportingCopy removes landing-page style overflow copy", () => {
  assert.equal(
    clampSupportingCopy("搜索页专注处理明确检索：关键字、搜索范围、排序与时间维度全部交给 URL 管理，分享与回退都更稳定。"),
    "关键字、排序与时间维度由 URL 管理。",
  );
});

test("getCompactCardColumns returns denser card count on desktop", () => {
  assert.equal(getCompactCardColumns(390), 3);
  assert.equal(getCompactCardColumns(768), 4);
  assert.equal(getCompactCardColumns(1180), 8);
  assert.equal(getCompactCardColumns(1440), 9);
});

test("getMobileGridColumns keeps phones on dense 2-up / 3-up grids", () => {
  assert.equal(getMobileGridColumns(360), 2);
  assert.equal(getMobileGridColumns(412), 2);
  assert.equal(getMobileGridColumns(430), 3);
});

test("getDesktopLayoutMode only enables website layout on large screens", () => {
  assert.equal(getDesktopLayoutMode(768), "compact");
  assert.equal(getDesktopLayoutMode(1179), "compact");
  assert.equal(getDesktopLayoutMode(1180), "desktop-site");
});

test("normalizeDrawerSectionState defaults to closed", () => {
  assert.equal(normalizeDrawerSectionState(undefined), "closed");
  assert.equal(normalizeDrawerSectionState("open"), "open");
  assert.equal(normalizeDrawerSectionState("weird"), "closed");
});

test("clampSupportingCopy trims already concise copy", () => {
  assert.equal(clampSupportingCopy("  输入关键词后开始检索。  "), "输入关键词后开始检索。");
});
