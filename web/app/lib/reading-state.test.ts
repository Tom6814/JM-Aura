import test from "node:test";
import assert from "node:assert/strict";

import {
  formatReaderStatus,
  mergeReadingState,
  normalizeThemeName,
  normalizeReaderWidth,
  parseStoredReadingState,
  readStoredTheme,
  readStoredReaderWidth,
  resolveResumeChapterId,
  writeStoredTheme,
} from "./reading-state";

test("normalizeThemeName only accepts dark/light", () => {
  assert.equal(normalizeThemeName("dark"), "dark");
  assert.equal(normalizeThemeName("light"), "light");
  assert.equal(normalizeThemeName("system"), "dark");
});

test("normalizeThemeName trims and normalizes supported values", () => {
  assert.equal(normalizeThemeName(" Light "), "light");
});

test("theme storage helpers normalize cached values", () => {
  assert.equal(
    readStoredTheme({
      getItem() {
        return "light";
      },
    }),
    "light",
  );

  assert.equal(
    readStoredTheme({
      getItem() {
        return "system";
      },
    }),
    "dark",
  );

  let writtenValue = "";
  writeStoredTheme(
    {
      setItem(_key, value) {
        writtenValue = value;
      },
    },
    "light",
  );
  assert.equal(writtenValue, "light");
});

test("normalizeReaderWidth clamps width for large screens", () => {
  assert.equal(normalizeReaderWidth(540), 540);
  assert.equal(normalizeReaderWidth(1600), 1040);
  assert.equal(normalizeReaderWidth(220), 320);
});

test("normalizeReaderWidth keeps readable bounds for immersive mode", () => {
  assert.equal(normalizeReaderWidth(1280), 1040);
  assert.equal(normalizeReaderWidth(760), 760);
});

test("formatReaderStatus keeps concise webtoon status copy", () => {
  assert.equal(
    formatReaderStatus({
      activeIndex: 4,
      total: 20,
      readerWidth: 680,
    }),
    "第 5 / 20 页 · 宽度 680px",
  );

  assert.equal(
    formatReaderStatus({
      activeIndex: 0,
      total: 0,
      readerWidth: 1400,
    }),
    "第 1 / 1 页 · 宽度 1040px",
  );
});

test("mergeReadingState keeps latest progress per manga", () => {
  assert.deepEqual(
    mergeReadingState(
      { mangaId: "413446", chapterId: "147643", progress: 0.45 },
      { mangaId: "413446", chapterId: "147700", progress: 0.1 },
    ),
    { mangaId: "413446", chapterId: "147700", progress: 0.1 },
  );
});

test("parseStoredReadingState ignores malformed payloads", () => {
  assert.equal(parseStoredReadingState(""), null);
  assert.equal(parseStoredReadingState("{"), null);
  assert.deepEqual(
    parseStoredReadingState(
      JSON.stringify({
        mangaId: "413446",
        chapterId: "147700",
        progress: 1.4,
      }),
    ),
    {
      mangaId: "413446",
      chapterId: "147700",
      progress: 1,
    },
  );
});

test("resolveResumeChapterId only resumes chapters from the same manga", () => {
  assert.equal(
    resolveResumeChapterId(
      {
        mangaId: "413446",
        chapterId: "147700",
        progress: 0.4,
      },
      "413446",
    ),
    "147700",
  );
  assert.equal(
    resolveResumeChapterId(
      {
        mangaId: "413446",
        chapterId: "147700",
        progress: 0.4,
      },
      "999999",
    ),
    null,
  );
});

test("readStoredReaderWidth falls back when storage value is invalid", () => {
  assert.equal(
    readStoredReaderWidth({
      getItem() {
        return "1600";
      },
    }),
    1040,
  );
  assert.equal(
    readStoredReaderWidth({
      getItem() {
        return "oops";
      },
    }),
    760,
  );
});

test("readStoredReaderWidth ignores legacy non-positive values", () => {
  assert.equal(
    readStoredReaderWidth({
      getItem() {
        return "0";
      },
    }),
    760,
  );
  assert.equal(
    readStoredReaderWidth({
      getItem() {
        return "-240";
      },
    }),
    760,
  );
});
