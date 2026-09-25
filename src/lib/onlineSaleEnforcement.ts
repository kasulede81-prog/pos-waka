/**
 * Server-side oversell enforcement eligibility (audit fix #1).
 *
 * A sale is eligible for the server's atomic `insufficient_stock` guard ONLY when
 * it was finalized while the device was online AND local stock was fresh — i.e.
 * it was rung up against authoritative stock. `buildSalePushPayload` reads this to
 * set `enforce_stock: true` on the cloud push; the server then rejects the sale
 * (and rolls it back) if another device consumed the stock first.
 *
 * This registry is intentionally EPHEMERAL (in-memory, per session). If a sale
 * survives a reload/crash before it syncs, it is treated as offline/delayed and
 * NOT enforced — the safe default, because its goods already left the shelf and
 * rejecting it at sync would lose a real, completed sale. Offline-first sync is
 * therefore never broken by this flag.
 */
const eligibleSaleIds = new Set<string>();

/** Mark a sale (finalized online + fresh stock) as eligible for server enforcement. */
export function markSaleEligibleForStockEnforcement(saleId: string): void {
  if (saleId) eligibleSaleIds.add(saleId);
}

/** True when the sale should be pushed with enforce_stock=true. */
export function saleEligibleForStockEnforcement(saleId: string): boolean {
  return !!saleId && eligibleSaleIds.has(saleId);
}

/** Drop a sale from the registry once it has synced (bounds memory). */
export function clearSaleStockEnforcement(saleId: string): void {
  eligibleSaleIds.delete(saleId);
}
