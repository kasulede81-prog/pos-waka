/**
 * First cloud-complete must upload the original paid sale, not a header
 * already reduced by a later local return/void.
 */

import type { Sale } from "../types";

export type CloudCompleteFinancials = NonNullable<Sale["cloudCompleteFinancials"]>;

export function captureCloudCompleteFinancials(
  sale: Pick<Sale, "subtotalUgx" | "totalUgx" | "cashPaidUgx" | "debtUgx" | "discountTotalUgx">,
): CloudCompleteFinancials {
  return {
    subtotalUgx: Math.max(0, Math.floor(Number(sale.subtotalUgx) || 0)),
    totalUgx: Math.max(0, Math.floor(Number(sale.totalUgx) || 0)),
    cashPaidUgx: Math.max(0, Math.floor(Number(sale.cashPaidUgx) || 0)),
    debtUgx: Math.max(0, Math.floor(Number(sale.debtUgx) || 0)),
    discountTotalUgx: Math.max(0, Math.floor(Number(sale.discountTotalUgx) || 0)),
  };
}

/**
 * Prefer the checkout snapshot. For older pending rows without a snapshot,
 * restore an all-cash header from voidedTotalUgx. Mixed-tender rows without
 * a snapshot keep live totals (do not guess cash vs debt).
 */
export function saleHeaderForCloudComplete(sale: Sale): CloudCompleteFinancials {
  if (sale.cloudCompleteFinancials) return sale.cloudCompleteFinancials;
  const voided = Math.max(0, Math.floor(Number(sale.voidedTotalUgx) || 0));
  const live = captureCloudCompleteFinancials(sale);
  if (sale.pendingSync === true && voided > 0 && live.debtUgx === 0) {
    return {
      ...live,
      totalUgx: live.totalUgx + voided,
      cashPaidUgx: live.cashPaidUgx + voided,
    };
  }
  return live;
}
