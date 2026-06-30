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

/** Total base-unit quantity for a product across draft lines, optionally including a new add. */
export function totalDraftQuantityForProduct(
  lines: SaleLine[],
  productId: string,
  mergeTarget?: SaleLine,
  incoming?: SaleLine,
): number {
  let total = 0;
  for (const line of lines) {
    if (line.productId !== productId) continue;
    if (mergeTarget && line === mergeTarget) continue;
    total += line.quantity;
  }
  if (mergeTarget && incoming) {
    total += mergeTarget.quantity + incoming.quantity;
  } else if (incoming) {
    total += incoming.quantity;
  }
  return Math.round(total * 10000) / 10000;
}
