import type { ReactNode } from "react";

export function SectionHeader(props: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  const className = `section-header${props.className ? ` ${props.className}` : ""}`;

  return (
    <div className={className}>
      <div className="section-header__copy">
        {props.eyebrow ? <span className="section-header__eyebrow">{props.eyebrow}</span> : null}
        <h2 className="section-header__title">{props.title}</h2>
        {props.description ? (
          <p className="section-header__description">{props.description}</p>
        ) : null}
      </div>
      {props.action ? <div className="section-header__action">{props.action}</div> : null}
    </div>
  );
}

export function HeroCard(props: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  media?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="hero-card">
      <div className="hero-card__content">
        {props.eyebrow ? <span className="hero-card__eyebrow">{props.eyebrow}</span> : null}
        <h1 className="hero-card__title">{props.title}</h1>
        {props.description ? <p className="hero-card__description">{props.description}</p> : null}
        {props.actions ? <div className="hero-card__actions">{props.actions}</div> : null}
        {props.children}
      </div>
      {props.media ? <div className="hero-card__media">{props.media}</div> : null}
    </section>
  );
}

export function ContentRail(props: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="content-rail">
      {props.title ? (
        <header className="content-rail__header">
          <div>
            <h2 className="content-rail__title">{props.title}</h2>
            {props.description ? (
              <p className="content-rail__description">{props.description}</p>
            ) : null}
          </div>
        </header>
      ) : null}
      <div className="content-rail__track">{props.children}</div>
    </section>
  );
}

export function StatusPanel(props: {
  tone?: "neutral" | "accent" | "success" | "error";
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const tone = props.tone ?? "neutral";
  return (
    <section className={`status-panel status-panel--${tone}`}>
      <div className="status-panel__content">
        <h3 className="status-panel__title">{props.title}</h3>
        <p className="status-panel__description">{props.description}</p>
      </div>
      {props.action ? <div className="status-panel__action">{props.action}</div> : null}
    </section>
  );
}

export function EmptyPanel(props: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-panel">
      <span className="material-symbols-rounded empty-panel__icon" aria-hidden="true">
        auto_stories
      </span>
      <h2 className="empty-panel__title">{props.title}</h2>
      <p className="empty-panel__description">{props.description}</p>
      {props.action ? <div className="empty-panel__action">{props.action}</div> : null}
    </div>
  );
}

export function MetaPill(props: { label: string; value: string }) {
  return (
    <div className="meta-pill">
      <span className="meta-pill__label">{props.label}</span>
      <span className="meta-pill__value">{props.value}</span>
    </div>
  );
}

export function TagPill(props: { children: ReactNode }) {
  return <span className="md-chip tag-pill">{props.children}</span>;
}
