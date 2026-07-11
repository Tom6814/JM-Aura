import type { MouseEventHandler, ReactNode } from "react";

type ReaderOverlayProps = {
  showChrome: boolean;
  topBar: ReactNode;
  bottomBar: ReactNode;
  onTopBarClick?: MouseEventHandler<HTMLElement>;
  onBottomBarClick?: MouseEventHandler<HTMLElement>;
};

export function ReaderOverlay(props: ReaderOverlayProps) {
  return (
    <>
      <header
        className={`reader-topbar${props.showChrome ? "" : " reader-topbar--hidden"}`}
        onClick={props.onTopBarClick}
      >
        <div className="reader-overlay__inner reader-overlay__inner--stage reader-overlay__inner--top">
          {props.topBar}
        </div>
      </header>

      <footer
        className={`reader-bottombar${props.showChrome ? "" : " reader-bottombar--hidden"}`}
        onClick={props.onBottomBarClick}
      >
        <div className="reader-overlay__inner reader-overlay__inner--stage reader-overlay__inner--bottom">
          {props.bottomBar}
        </div>
      </footer>
    </>
  );
}
