import { isWalkInSupplierId } from "../../../lib/walkInSupplier";

export type ReceiveBuySource = "town" | "supplier";

/** Named (non–walk-in) suppliers usable for the unpaid/partial receive path. */
export function namedSuppliersForReceive<T extends { id: string }>(suppliers: T[]): T[] {
  return suppliers.filter((s) => !isWalkInSupplierId(s.id));
}

/**
 * UX default only — does not create purchases, balances, or sync work.
 * Prefer "From a supplier" when at least one named supplier exists so unpaid
 * payment controls are visible; otherwise keep Town / market.
 */
export function defaultReceiveBuySource(suppliers: { id: string }[]): ReceiveBuySource {
  return namedSuppliersForReceive(suppliers).length > 0 ? "supplier" : "town";
}
