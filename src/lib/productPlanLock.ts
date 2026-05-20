import type { Product } from "../types";

/** Products beyond the free-tier cap stay visible but cannot be sold or edited. */
export function lockedProductIds(products: readonly Product[], limit: number | null): Set<string> {
  if (limit === null || limit < 0) return new Set();
  return new Set(products.slice(limit).map((p) => p.id));
}

export function isProductPlanLocked(productId: string, locked: Set<string>): boolean {
  return locked.has(productId);
}
