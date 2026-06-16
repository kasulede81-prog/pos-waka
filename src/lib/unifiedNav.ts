/** Primary app navigation — same on mobile and desktop. */
export const UNIFIED_PRIMARY_NAV_PATHS = ["/", "/pos", "/office"] as const;

export type UnifiedNavPath = (typeof UNIFIED_PRIMARY_NAV_PATHS)[number];

/** Stock-only roles use Stock instead of Shop in the third slot. */
export function unifiedThirdNavPath(hasShop: boolean, hasStockOnly: boolean): "/office" | "/stock" {
  if (hasShop) return "/office";
  if (hasStockOnly) return "/stock";
  return "/office";
}

export function orderNavByPaths<T extends { path: string }>(items: T[], paths: readonly string[]): T[] {
  const byPath = new Map(items.map((item) => [item.path, item]));
  return paths.map((path) => byPath.get(path)).filter((item): item is T => Boolean(item));
}
