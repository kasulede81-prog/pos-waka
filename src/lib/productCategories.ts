import type { Product } from "../types";

/** Stored in preferences / filters for products with no category text. */
export const UNCATEGORIZED_SENTINEL = "__waka_uncategorized__";

/** Internal “show every product” value (not persisted; preferences use undefined for All). */
export const CATEGORY_FILTER_ALL = "__waka_all__";

export function normalizedCategoryKey(p: Product): string {
  return (p.category ?? "").trim();
}

/** Distinct non-empty `category` values, A–Z. */
export function distinctTrimmedCategories(products: readonly Product[]): string[] {
  const seen = new Set<string>();
  for (const p of products) {
    const c = normalizedCategoryKey(p);
    if (c.length > 0) seen.add(c);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function productMatchesCategoryFilter(p: Product, filter: string): boolean {
  if (filter === CATEGORY_FILTER_ALL) return true;
  if (filter === UNCATEGORIZED_SENTINEL) return normalizedCategoryKey(p).length === 0;
  return normalizedCategoryKey(p) === filter;
}
