export function hasRequestCookie(cookieHeader: string | null, name: string): boolean {
  if (!cookieHeader || name.trim().length === 0) {
    return false;
  }

  const entries = cookieHeader.split(/;\s*/g);
  return entries.some((entry) => {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      return false;
    }

    return entry.slice(0, separatorIndex) === name;
  });
}
