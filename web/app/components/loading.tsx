import { MediaGrid, SectionHeader } from "./ui";

export function ContinueReadingSkeleton() {
  return (
    <section className="home-continue-mini home-continue-mini--skeleton" aria-hidden="true">
      <div className="home-continue-mini__skeleton-copy">
        <span className="content-skeleton-chip" />
        <span className="content-skeleton-line content-skeleton-line--title" />
        <span className="content-skeleton-line content-skeleton-line--meta" />
      </div>

      <div className="home-continue-mini__skeleton-actions">
        <span className="content-skeleton-block content-skeleton-block--button" />
        <span className="content-skeleton-block content-skeleton-block--button" />
      </div>

      <div className="home-continue-mini__skeleton-tags">
        <span className="content-skeleton-chip" />
        <span className="content-skeleton-chip" />
        <span className="content-skeleton-chip" />
      </div>
    </section>
  );
}

export function HomeGridSkeleton(props: {
  count: number;
  title?: string;
  description?: string;
}) {
  return (
    <section className="home-flow">
      {props.title ? (
        <SectionHeader eyebrow="最新" title={props.title} description={props.description} />
      ) : null}

      <MediaGrid className="media-grid--home media-grid--skeleton">
        {Array.from({ length: props.count }).map((_, index) => (
          <div key={index} className="content-skeleton-card" />
        ))}
      </MediaGrid>
    </section>
  );
}

export function RankingPanelSkeleton(props: { title: string }) {
  return (
    <section className="home-ranking-panel home-ranking-panel--skeleton" aria-hidden="true">
      <header className="home-ranking-panel__header">
        <h3 className="home-ranking-panel__title">{props.title}</h3>
      </header>

      <div className="content-skeleton-list">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="content-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function DiscoverGridSkeleton(props: { count: number }) {
  return (
    <div className="discover-grid" aria-hidden="true">
      {Array.from({ length: props.count }).map((_, index) => (
        <div key={index} className="content-skeleton-card" />
      ))}
    </div>
  );
}

export function ProfileCardSkeleton(props: {
  eyebrow: string;
  title: string;
  rows?: number;
  chips?: number;
  showAction?: boolean;
}) {
  return (
    <section
      className="md-card"
      aria-hidden="true"
      style={{
        padding: "24px",
        display: "grid",
        gap: "20px",
        background: "var(--md-sys-color-surface-container-low)",
      }}
    >
      <SectionHeader
        eyebrow={props.eyebrow}
        title={props.title}
        description="当前区块正在同步。"
        action={
          props.showAction ? (
            <span
              className="content-skeleton-block content-skeleton-block--button"
              style={{ width: "132px" }}
            />
          ) : undefined
        }
      />

      {props.chips ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          {Array.from({ length: props.chips }).map((_, index) => (
            <span
              key={index}
              className="content-skeleton-chip"
              style={{ width: `${72 + index * 10}px` }}
            />
          ))}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "12px" }}>
        {Array.from({ length: props.rows ?? 3 }).map((_, index) => (
          <div
            key={index}
            className="content-skeleton-line"
            style={{ width: index === 0 ? "72%" : index === 1 ? "88%" : "64%" }}
          />
        ))}
      </div>
    </section>
  );
}

export function ProfileTaskListSkeleton() {
  return (
    <section
      className="md-card"
      aria-hidden="true"
      style={{
        padding: "24px",
        display: "grid",
        gap: "20px",
        background: "var(--md-sys-color-surface-container-low)",
      }}
    >
      <SectionHeader
        eyebrow="下载"
        title="正在同步任务列表"
        description="任务状态与下载入口稍后填充。"
      />

      <div style={{ display: "grid", gap: "12px" }}>
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="md-card"
            style={{
              display: "grid",
              gap: "14px",
              padding: "18px",
              background: "var(--md-sys-color-surface-container)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <span className="content-skeleton-chip" style={{ width: "72px" }} />
              <span className="content-skeleton-chip" style={{ width: "96px" }} />
            </div>
            <div style={{ display: "grid", gap: "8px" }}>
              <div className="content-skeleton-line" style={{ width: "68%" }} />
              <div className="content-skeleton-line" style={{ width: "42%" }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              <span
                className="content-skeleton-block content-skeleton-block--button"
                style={{ width: "144px" }}
              />
              <div className="content-skeleton-line" style={{ width: "36%" }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
