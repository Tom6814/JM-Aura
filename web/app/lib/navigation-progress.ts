export type NavigationProgressPhase = "idle" | "running" | "completing";

export const DOCUMENT_NAVIGATION_START_EVENT = "aura:document-navigation-start";

export type NavigationProgressState = {
  visible: boolean;
  value: number;
  phase: NavigationProgressPhase;
};

type NavigationProgressEvent =
  | { type: "navigation-start" }
  | { type: "tick" }
  | { type: "navigation-complete" };

export function reduceNavigationProgress(
  current: NavigationProgressState,
  event: NavigationProgressEvent,
): NavigationProgressState {
  if (event.type === "navigation-start") {
    return { visible: true, value: 0.12, phase: "running" };
  }

  if (event.type === "tick" && current.phase === "running") {
    return {
      ...current,
      value: Math.min(0.82, Number((current.value + 0.08).toFixed(2))),
    };
  }

  if (event.type === "navigation-complete") {
    return { visible: true, value: 1, phase: "completing" };
  }

  return current;
}

export function getNavigationProgressSnapshot(input: {
  navigationState: "idle" | "loading" | "submitting";
  hasPendingFetchers: boolean;
  previous: NavigationProgressState;
}): NavigationProgressState {
  if (input.navigationState !== "idle" || input.hasPendingFetchers) {
    if (!input.previous.visible || input.previous.phase === "completing") {
      return reduceNavigationProgress(input.previous, { type: "navigation-start" });
    }

    return reduceNavigationProgress(input.previous, { type: "tick" });
  }

  if (input.previous.visible && input.previous.phase !== "completing") {
    return reduceNavigationProgress(input.previous, { type: "navigation-complete" });
  }

  return input.previous;
}

export function shouldStartDocumentNavigationProgress(input: {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  target?: string | null;
}) {
  return (
    !input.defaultPrevented &&
    input.button === 0 &&
    !input.metaKey &&
    !input.altKey &&
    !input.ctrlKey &&
    !input.shiftKey &&
    (!input.target || input.target === "_self")
  );
}
