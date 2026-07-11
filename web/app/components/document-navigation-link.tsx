import type { ComponentProps, MouseEvent } from "react";
import { Link, useHref } from "@remix-run/react";

import {
  DOCUMENT_NAVIGATION_START_EVENT,
  shouldStartDocumentNavigationProgress,
} from "../lib/navigation-progress";

type DocumentNavigationLinkProps = Omit<ComponentProps<typeof Link>, "reloadDocument">;

export function DocumentNavigationLink(props: DocumentNavigationLinkProps) {
  const href = useHref(props.to);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    props.onClick?.(event);

    if (
      !shouldStartDocumentNavigationProgress({
        defaultPrevented: event.defaultPrevented,
        button: event.button,
        metaKey: event.metaKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        target: props.target,
      })
    ) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    event.preventDefault();
    window.dispatchEvent(new CustomEvent(DOCUMENT_NAVIGATION_START_EVENT));

    const navigate = () => {
      window.location.assign(href);
    };

    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => navigate());
      return;
    }

    window.setTimeout(navigate, 16);
  }

  return <Link {...props} reloadDocument onClick={handleClick} />;
}
