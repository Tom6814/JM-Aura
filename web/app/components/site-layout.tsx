import type { ReactNode } from "react";

import { SectionHeader } from "./primitives";

export function SiteToolbar(props: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  const className = `site-toolbar${props.className ? ` ${props.className}` : ""}`;

  return (
    <section className={className}>
      <div className="site-toolbar__body">
        <SectionHeader
          className="site-toolbar__header"
          eyebrow={props.eyebrow}
          title={props.title}
          description={props.description}
        />
        {props.children ? <div className="site-toolbar__content">{props.children}</div> : null}
      </div>
      {props.aside ? <div className="site-toolbar__aside">{props.aside}</div> : null}
    </section>
  );
}

export function MediaGrid(props: {
  children: ReactNode;
  variant?: "default" | "directory";
  className?: string;
}) {
  const variant = props.variant ?? "default";
  const className = `media-grid media-grid--${variant}${props.className ? ` ${props.className}` : ""}`;

  return <div className={className}>{props.children}</div>;
}
