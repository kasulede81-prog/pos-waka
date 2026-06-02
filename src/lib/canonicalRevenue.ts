/**
 * Canonical revenue — matches sale.totalUgx (cart + line discounts, voids on header)
 * minus refunds only when the linked sale is outside the scoped sale set.
 */

import type { ReturnRecord, Sale } from "../types";

function refundUgx(r: ReturnRecord): number {
  return Math.max(0, Math.floor(r.refundAmountUgx));
}

/**
 * Net revenue from completed sales in scope.
 * Linked returns on scoped sales are already reflected in sale.totalUgx / cashPaid / debt.
 */
export function computeCanonicalRevenueUgx(scopedSales: Sale[], returnScoped: ReturnRecord[]): number {
  const saleIds = new Set(scopedSales.map((s) => s.id));
  let revenue = scopedSales.reduce((sum, s) => sum + Math.max(0, s.totalUgx), 0);

  for (const rec of returnScoped) {
    const refund = refundUgx(rec);
    if (refund <= 0) continue;
    const sid = rec.saleId;
    if (!sid || !saleIds.has(sid)) {
      revenue -= refund;
    }
  }

  return Math.max(0, Math.round(revenue));
}

/** Refunds on scoped returns where the sale is not in the scoped sale set (e.g. cross-day). */
export function externalReturnRefundsUgx(scopedSales: Sale[], returnScoped: ReturnRecord[]): number {
  const saleIds = new Set(scopedSales.map((s) => s.id));
  let total = 0;
  for (const rec of returnScoped) {
    const refund = refundUgx(rec);
    if (refund <= 0) continue;
    const sid = rec.saleId;
    if (!sid || !saleIds.has(sid)) total += refund;
  }
  return total;
}
