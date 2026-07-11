export type DrawerSectionState = "open" | "closed";

export function clampSupportingCopy(input: string): string {
  const normalized = input.trim();

  if (normalized.includes("关键字、搜索范围、排序与时间维度")) {
    return "关键字、排序与时间维度由 URL 管理。";
  }

  return normalized;
}

export function getCompactCardColumns(width: number): number {
  if (width >= 1380) {
    return 9;
  }

  if (width >= 1180) {
    return 8;
  }

  if (width >= 700) {
    return 4;
  }

  return 3;
}

export function getMobileGridColumns(width: number): number {
  if (width >= 430) {
    return 3;
  }

  return 2;
}

export function getDesktopLayoutMode(width: number): "compact" | "desktop-site" {
  return width >= 1180 ? "desktop-site" : "compact";
}

export function normalizeDrawerSectionState(input: string | undefined): DrawerSectionState {
  return input === "open" ? "open" : "closed";
}
