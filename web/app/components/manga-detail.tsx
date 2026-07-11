import type { ReactNode } from "react";
import { Form } from "@remix-run/react";
import type { FavoriteFolder } from "../../../packages/shared/src/schema";

import { BackdropImage } from "./ui";
import { FilterDrawer } from "./filter-drawer";

export type MangaDetailLayoutProps = {
  eyebrow?: string;
  title: string;
  description: string;
  backdropSrc?: string | null;
  cover: ReactNode;
  heroBadges?: ReactNode;
  heroTags?: ReactNode;
  heroMeta?: ReactNode;
  heroActions?: ReactNode;
  heroSupport?: ReactNode;
  status?: ReactNode;
  tabs: ReactNode;
  main: ReactNode;
  aside?: ReactNode;
};

export function MangaDetailLayout(props: MangaDetailLayoutProps) {
  return (
    <div className="manga-detail-layout">
      <section className="manga-detail-layout__hero-shell">
        <BackdropImage src={props.backdropSrc ?? null} className="manga-detail-layout__backdrop" />
        <div className="app-container manga-detail-layout__hero-container">
          <section className="manga-detail-layout__hero-surface">
            <div className="manga-detail-layout__hero">
              <div className="manga-detail-layout__cover">{props.cover}</div>

              <div className="manga-detail-layout__hero-main">
                <div className="manga-detail-layout__hero-body">
                  <div className="manga-detail-layout__hero-header">
                    {props.eyebrow ? (
                      <span className="manga-detail-layout__eyebrow">{props.eyebrow}</span>
                    ) : null}
                    {props.heroBadges ? (
                      <div className="manga-detail-layout__hero-badges">{props.heroBadges}</div>
                    ) : null}
                  </div>

                  <div className="manga-detail-layout__hero-copy">
                    <h1 className="manga-detail-layout__title">{props.title}</h1>
                    <p className="manga-detail-layout__description">{props.description}</p>
                  </div>

                  {props.heroTags ? (
                    <div className="manga-detail-layout__hero-tags">{props.heroTags}</div>
                  ) : null}

                  {props.heroMeta ? (
                    <div className="manga-detail-layout__hero-facts">{props.heroMeta}</div>
                  ) : null}

                  {props.heroActions ? (
                    <div className="manga-detail-layout__hero-actions">{props.heroActions}</div>
                  ) : null}
                </div>
              </div>

              {props.heroSupport ? (
                <aside className="manga-detail-layout__hero-side">
                  <div className="manga-detail-layout__hero-support">{props.heroSupport}</div>
                </aside>
              ) : null}
            </div>
          </section>
        </div>
      </section>

      <div className="app-container compact-page-shell manga-detail-layout__shell">
        {props.status ? <div className="manga-detail-layout__status">{props.status}</div> : null}
        <div className="manga-detail-layout__tabs">{props.tabs}</div>

        <div className="manga-detail-layout__content">
          <div className="manga-detail-layout__main">{props.main}</div>
          {props.aside ? <div className="manga-detail-layout__aside">{props.aside}</div> : null}
        </div>
      </div>
    </div>
  );
}

type FavoriteFolderPickerProps = {
  open: boolean;
  loading: boolean;
  pending: boolean;
  folders: FavoriteFolder[];
  selectedFolderId: string;
  onClose: () => void;
};

export function FavoriteFolderPicker(props: FavoriteFolderPickerProps) {
  return (
    <FilterDrawer
      title="收藏到哪个收藏夹"
      open={props.open}
      onClose={props.onClose}
      className="manga-favorite-picker"
    >
      <div className="manga-favorite-picker__content">
        {props.loading ? (
          <p className="manga-favorite-picker__hint">正在同步收藏夹列表…</p>
        ) : (
          <Form method="post" className="manga-favorite-picker__form">
            <input type="hidden" name="intent" value="favorite" />
            <div className="manga-favorite-picker__options" role="radiogroup" aria-label="收藏夹列表">
              {props.folders.map((folder) => (
                <label key={folder.FID} className="manga-favorite-picker__option">
                  <input
                    type="radio"
                    name="folder_id"
                    value={folder.FID}
                    defaultChecked={folder.FID === props.selectedFolderId}
                  />
                  <span>{folder.name}</span>
                </label>
              ))}
            </div>
            <div className="manga-favorite-picker__actions">
              <button type="submit" className="md-button md-button--primary" disabled={props.pending}>
                {props.pending ? "收藏中..." : "确认收藏"}
              </button>
            </div>
          </Form>
        )}
      </div>
    </FilterDrawer>
  );
}

type DownloadChapterPickerProps = {
  open: boolean;
  pending: boolean;
  episodes: Array<{ photo_id: string; sort: string; name: string }>;
  selectedChapterIds: string[];
  onToggleChapter: (chapterId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onClose: () => void;
};

export function DownloadChapterPicker(props: DownloadChapterPickerProps) {
  return (
    <FilterDrawer
      title="选择要下载的章节"
      open={props.open}
      onClose={props.onClose}
      className="manga-download-picker"
    >
      <div className="manga-download-picker__content">
        <Form method="post" className="manga-download-picker__form">
          <input type="hidden" name="intent" value="download_selected" />

          <div className="manga-download-picker__toolbar">
            <button
              type="button"
              className="md-button md-button--surface"
              onClick={props.onSelectAll}
            >
              全选
            </button>
            <button
              type="button"
              className="md-button md-button--surface"
              onClick={props.onClear}
            >
              清空
            </button>
          </div>

          <div className="manga-download-picker__options" role="group" aria-label="章节列表">
            {props.episodes.map((episode) => {
              const checked = props.selectedChapterIds.includes(episode.photo_id);
              return (
                <label key={episode.photo_id} className="manga-download-picker__option">
                  <input
                    type="checkbox"
                    name="chapter_ids"
                    value={episode.photo_id}
                    checked={checked}
                    onChange={() => props.onToggleChapter(episode.photo_id)}
                  />
                  <span className="manga-download-picker__option-copy">
                    <strong>{episode.name || `第 ${episode.sort} 话`}</strong>
                    <small>第 {episode.sort} 话</small>
                  </span>
                </label>
              );
            })}
          </div>

          {props.episodes
            .filter((episode) => props.selectedChapterIds.includes(episode.photo_id))
            .map((episode) => (
              <input
                key={`selected-chapter-${episode.photo_id}`}
                type="hidden"
                name="selected_chapters"
                value={JSON.stringify({
                  chapterId: episode.photo_id,
                  chapterTitle: episode.name || null,
                  chapterSort: episode.sort || null,
                })}
              />
            ))}

          <div className="manga-download-picker__actions">
            <button
              type="submit"
              className="md-button md-button--primary"
              disabled={props.pending || props.selectedChapterIds.length === 0}
            >
              {props.pending ? "创建中..." : "确认下载"}
            </button>
          </div>
        </Form>
      </div>
    </FilterDrawer>
  );
}
