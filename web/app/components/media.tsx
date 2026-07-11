import type { CSSProperties } from "react";

export function MediaPlaceholder(props: {
  label: string;
  icon?: string;
  className?: string;
}) {
  return (
    <div className={`media-placeholder${props.className ? ` ${props.className}` : ""}`}>
      <span className="material-symbols-rounded media-placeholder__icon" aria-hidden="true">
        {props.icon ?? "image"}
      </span>
      <span className="media-placeholder__label">{props.label.slice(0, 1)}</span>
    </div>
  );
}

export function ResponsiveImage(props: {
  src: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  decoding?: "sync" | "async" | "auto";
}) {
  return (
    <img
      src={props.src}
      alt={props.alt}
      className={`responsive-image${props.className ? ` ${props.className}` : ""}`}
      loading={props.loading ?? "lazy"}
      decoding={props.decoding ?? "async"}
    />
  );
}

export function CoverArtwork(props: {
  src: string | null;
  title: string;
  aspectRatio?: string;
  className?: string;
  size?: "compact" | "default";
}) {
  const style = props.aspectRatio
    ? ({ aspectRatio: props.aspectRatio } satisfies CSSProperties)
    : undefined;
  const sizeClass = props.size === "compact" ? " media-cover--compact" : "";

  return (
    <div className={`media-cover${sizeClass}${props.className ? ` ${props.className}` : ""}`} style={style}>
      {props.src ? (
        <ResponsiveImage
          src={props.src}
          alt={props.title}
          className="media-cover__image"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <MediaPlaceholder className="media-cover__placeholder" label={props.title} icon="book_2" />
      )}
    </div>
  );
}

export function BackdropImage(props: {
  src: string | null;
  alt?: string;
  className?: string;
}) {
  if (props.src === null) {
    return <div className={`media-backdrop${props.className ? ` ${props.className}` : ""}`} />;
  }

  return (
    <div className={`media-backdrop${props.className ? ` ${props.className}` : ""}`}>
      <ResponsiveImage
        src={props.src}
        alt={props.alt ?? ""}
        className="media-backdrop__image"
        loading="eager"
        decoding="async"
      />
      <div className="media-backdrop__scrim" />
    </div>
  );
}
