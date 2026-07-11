export function getMangaDetailQueryLinkProps() {
  return {
    prefetch: "intent" as const,
    preventScrollReset: true,
  };
}

