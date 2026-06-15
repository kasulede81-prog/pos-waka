import type { Product, SaleLine } from "../types";

/** Read-only: would this draft line quantity exceed on-hand stock? */
export function draftQuantityExceedsStock(product: Product, quantity: number): boolean {
  const available = Math.max(0, Number(product.stockOnHand) || 0);
  return quantity > available + 0.0001;
}

/** Quantity after merging an add with an existing cart line for the same product. */
export function mergedDraftQuantity(existing: SaleLine | undefined, addedQuantity: number): number {
  if (!existing) return addedQuantity;
  return Math.round((existing.quantity + addedQuantity) * 10000) / 10000;
}
