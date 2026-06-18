/**
 * Pre-sale stock revalidation and cart version snapshots for cross-tab safety.
 */

import type { Product, SaleLine } from "../types";

export function attachStockVersionToLine(product: Product, line: SaleLine): SaleLine {
  return { ...line, stockVersionAtAdd: product.version ?? 1 };
}

export function productVersionChangedSinceLineAdd(line: SaleLine, product: Product): boolean {
  if (line.stockVersionAtAdd == null) return false;
  return line.stockVersionAtAdd !== (product.version ?? 1);
}

export type DraftSaleStockValidation =
  | { ok: true }
  | { ok: false; errorKey: "missingProduct" | "noStock" | "stockChangedAnotherWindow" };

/**
 * All-or-nothing stock check immediately before sale finalization.
 * Re-reads current product stock; aborts if any line exceeds on-hand quantity.
 */
export function validateDraftSaleStockBeforeFinalize(
  draftLines: SaleLine[],
  products: Product[],
): DraftSaleStockValidation {
  for (const line of draftLines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product) return { ok: false, errorKey: "missingProduct" };

    const available = Math.max(0, Number(product.stockOnHand) || 0);
    if (line.quantity > available + 0.0001) {
      if (productVersionChangedSinceLineAdd(line, product)) {
        return { ok: false, errorKey: "stockChangedAnotherWindow" };
      }
      return { ok: false, errorKey: "noStock" };
    }

    if (productVersionChangedSinceLineAdd(line, product)) {
      // Version moved in another tab — revalidate quantity against fresh stock (already checked above).
      continue;
    }
  }
  return { ok: true };
}

/** Apply a remote tab's stock update without downgrading newer local version. */
export function mergeRemoteInventoryStock(
  local: Product,
  incoming: { newStock: number; version: number; timestamp: number },
): Product | null {
  const localVersion = local.version ?? 1;
  if (incoming.version < localVersion) return null;
  if (incoming.version === localVersion && local.stockOnHand === incoming.newStock) return null;
  return {
    ...local,
    stockOnHand: incoming.newStock,
    version: Math.max(localVersion, incoming.version),
    updatedAt: new Date(incoming.timestamp).toISOString(),
  };
}
