import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type FilterDrawerProps = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

export function getFilterDrawerPortalTarget(doc: { body?: unknown } | null | undefined) {
  return doc?.body ?? null;
}

export function FilterDrawer(props: FilterDrawerProps) {
  const [portalTarget, setPortalTarget] = useState<unknown>(null);

  useEffect(() => {
    setPortalTarget(getFilterDrawerPortalTarget(document));
  }, []);

  const content = (
    <div
      className={`filter-drawer${props.open ? " filter-drawer--open" : ""}${props.className ? ` ${props.className}` : ""}`}
      aria-hidden={!props.open}
      hidden={!props.open}
    >
      <button
        type="button"
        className="filter-drawer__backdrop"
        aria-label="关闭筛选抽屉"
        tabIndex={props.open ? 0 : -1}
        onClick={props.onClose}
      />
      <section
        className="filter-drawer__panel"
        role="dialog"
        aria-modal={props.open ? "true" : undefined}
        aria-label={props.title}
      >
        <header className="filter-drawer__header">
          <h2 className="filter-drawer__title">{props.title}</h2>
          <button type="button" className="md-button md-button--surface" onClick={props.onClose}>
            关闭
          </button>
        </header>
        <div className="filter-drawer__body">{props.children}</div>
      </section>
    </div>
  );

  if (typeof HTMLElement !== "undefined" && portalTarget instanceof HTMLElement) {
    return createPortal(content, portalTarget);
  }

  return content;
}
