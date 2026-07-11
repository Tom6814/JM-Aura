import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_NAVIGATION_START_EVENT,
  getNavigationProgressSnapshot,
  reduceNavigationProgress,
  shouldStartDocumentNavigationProgress,
} from "./navigation-progress";

test("reduceNavigationProgress starts visible progress for pending navigation", () => {
  const state = reduceNavigationProgress(
    { visible: false, value: 0, phase: "idle" },
    { type: "navigation-start" },
  );

  assert.equal(state.visible, true);
  assert.equal(state.phase, "running");
  assert.equal(state.value, 0.12);
});

test("reduceNavigationProgress caps running progress before completion", () => {
  const state = reduceNavigationProgress(
    { visible: true, value: 0.68, phase: "running" },
    { type: "tick" },
  );

  assert.equal(state.phase, "running");
  assert.equal(state.value <= 0.82, true);
});

test("getNavigationProgressSnapshot completes and hides after settle", () => {
  const snapshot = getNavigationProgressSnapshot({
    navigationState: "idle",
    hasPendingFetchers: false,
    previous: { visible: true, value: 0.74, phase: "running" },
  });

  assert.equal(snapshot.phase, "completing");
  assert.equal(snapshot.value, 1);
});

test("shouldStartDocumentNavigationProgress only allows plain same-tab primary clicks", () => {
  assert.equal(
    shouldStartDocumentNavigationProgress({
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      target: undefined,
    }),
    true,
  );

  assert.equal(
    shouldStartDocumentNavigationProgress({
      defaultPrevented: false,
      button: 0,
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      target: undefined,
    }),
    false,
  );

  assert.equal(
    shouldStartDocumentNavigationProgress({
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      target: "_blank",
    }),
    false,
  );
});

test("document navigation event name remains stable", () => {
  assert.equal(DOCUMENT_NAVIGATION_START_EVENT, "aura:document-navigation-start");
});
