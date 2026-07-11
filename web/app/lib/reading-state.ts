export type ThemeName = "dark" | "light";

export type ReadingState = {
  mangaId: string;
  chapterId: string;
  progress: number;
};

export const READING_STATE_STORAGE_KEY = "jm_reading_state";
export const READER_WIDTH_STORAGE_KEY = "jm_reader_width";
export const THEME_STORAGE_KEY = "jm_theme";
export const DEFAULT_READER_WIDTH = 760;
const MIN_READER_WIDTH = 320;
const MAX_READER_WIDTH = 1040;

export function normalizeThemeName(
  input: string | null | undefined,
): ThemeName {
  const normalized = input?.trim().toLowerCase();
  return normalized === "light" ? "light" : "dark";
}

export function readStoredTheme(storage: Pick<Storage, "getItem">): ThemeName {
  return normalizeThemeName(storage.getItem(THEME_STORAGE_KEY));
}

export function writeStoredTheme(
  storage: Pick<Storage, "setItem">,
  theme: ThemeName,
): void {
  storage.setItem(THEME_STORAGE_KEY, normalizeThemeName(theme));
}

export function normalizeReaderWidth(input: number): number {
  const numeric = Number.isFinite(input) ? input : DEFAULT_READER_WIDTH;
  return Math.max(MIN_READER_WIDTH, Math.min(MAX_READER_WIDTH, Math.round(numeric)));
}

export function formatReaderStatus(input: {
  activeIndex: number;
  total: number;
  readerWidth: number;
}): string {
  const total = Math.max(1, Math.round(Number.isFinite(input.total) ? input.total : 1));
  const activeIndex = Number.isFinite(input.activeIndex) ? Math.max(0, Math.round(input.activeIndex)) : 0;
  const currentPage = Math.min(total, activeIndex + 1);
  const readerWidth = normalizeReaderWidth(input.readerWidth);

  return `第 ${currentPage} / ${total} 页 · 宽度 ${readerWidth}px`;
}

export function mergeReadingState(
  _prev: ReadingState,
  next: ReadingState,
): ReadingState {
  return next;
}

export function parseStoredReadingState(
  input: string | null | undefined,
): ReadingState | null {
  if (!input) {
    return null;
  }

  try {
    const parsed = JSON.parse(input) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).mangaId !== "string" ||
      typeof (parsed as Record<string, unknown>).chapterId !== "string"
    ) {
      return null;
    }

    const progress = clampReadingProgress(
      Number((parsed as Record<string, unknown>).progress),
    );

    return {
      mangaId: (parsed as Record<string, string>).mangaId,
      chapterId: (parsed as Record<string, string>).chapterId,
      progress,
    };
  } catch {
    return null;
  }
}

export function resolveResumeChapterId(
  state: ReadingState | null | undefined,
  mangaId: string,
): string | null {
  if (!state || state.mangaId !== mangaId) {
    return null;
  }

  return state.chapterId;
}

export function readStoredReaderWidth(storage: Pick<Storage, "getItem">): number {
  const stored = Number.parseInt(
    storage.getItem(READER_WIDTH_STORAGE_KEY) ?? "",
    10,
  );

  if (!Number.isFinite(stored) || stored <= 0) {
    return DEFAULT_READER_WIDTH;
  }

  return normalizeReaderWidth(stored);
}

export function readStoredReadingState(
  storage: Pick<Storage, "getItem">,
): ReadingState | null {
  return parseStoredReadingState(storage.getItem(READING_STATE_STORAGE_KEY));
}

export function writeStoredReaderWidth(
  storage: Pick<Storage, "setItem">,
  width: number,
): void {
  storage.setItem(READER_WIDTH_STORAGE_KEY, String(normalizeReaderWidth(width)));
}

export function writeStoredReadingState(
  storage: Pick<Storage, "setItem">,
  state: ReadingState,
): void {
  storage.setItem(
    READING_STATE_STORAGE_KEY,
    JSON.stringify({
      mangaId: state.mangaId,
      chapterId: state.chapterId,
      progress: clampReadingProgress(state.progress),
    }),
  );
}

function clampReadingProgress(input: number): number {
  if (!Number.isFinite(input)) {
    return 0;
  }

  return Math.max(0, Math.min(1, input));
}
