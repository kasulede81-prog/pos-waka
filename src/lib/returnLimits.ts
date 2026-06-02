/**
 * Return / refund ceilings — prevent money creation via over-refund.
 */

import type { ReturnRecord, Sale, SaleLine } from "../types";

export function refundsOnSale(returnRecords: ReturnRecord[], saleId: string): number {
  return returnRecords
    .filter((r) => r.saleId === saleId)
    .reduce((sum, r) => sum + Math.max(0, Math.floor(r.refundAmountUgx)), 0);
}

export function returnedQuantityOnSale(
  returnRecords: ReturnRecord[],
  saleId: string,
  productId: string,
): number {
  return returnRecords
    .filter((r) => r.saleId === saleId && r.productId === productId)
    .reduce((sum, r) => sum + Math.max(0, r.quantity), 0);
}

export function activeSaleLine(sale: Sale, productId: string): SaleLine | undefined {
  return sale.lines.find((l) => l.productId === productId && !l.voided);
}

/** UGX still refundable on this sale (current header total after prior returns/voids). */
export function remainingRefundableAmount(sale: Sale, pendingRefundUgx = 0): number {
  return Math.max(0, Math.floor(sale.totalUgx) - Math.max(0, Math.floor(pendingRefundUgx)));
}

/** Base units still returnable for a product on this sale. */
export function remainingReturnableQuantity(
  sale: Sale,
  productId: string,
  returnRecords: ReturnRecord[],
  pendingQty = 0,
): number {
  const line = activeSaleLine(sale, productId);
  if (!line) return 0;
  const already = returnedQuantityOnSale(returnRecords, sale.id, productId);
  return Math.max(0, line.quantity - already - Math.max(0, pendingQty));
}

/** Max refund for a quantity on one line (proportional to line total). */
export function remainingRefundableForLineQty(
  sale: Sale,
  productId: string,
  quantity: number,
  returnRecords: ReturnRecord[],
): number {
  const line = activeSaleLine(sale, productId);
  if (!line || quantity <= 0) return 0;
  const qty = Math.min(quantity, remainingReturnableQuantity(sale, productId, returnRecords));
  if (qty <= 0) return 0;
  const unit =
    line.quantity > 0 ? line.lineTotalUgx / line.quantity : line.lineTotalUgx;
  return Math.max(0, Math.round(unit * qty));
}

export type ReturnLimitCheck = { ok: true } | { ok: false; errorKey: string };

export function validateReturnAgainstSale(input: {
  sale: Sale;
  productId: string;
  quantity: number;
  refundAmountUgx: number;
  returnRecords: ReturnRecord[];
}): ReturnLimitCheck {
  const qty = Math.max(0, Number(input.quantity) || 0);
  const refund = Math.max(0, Math.floor(input.refundAmountUgx));
  if (qty <= 0 || refund <= 0) return { ok: false, errorKey: "invalid" };

  const remainingQty = remainingReturnableQuantity(
    input.sale,
    input.productId,
    input.returnRecords,
  );
  if (qty > remainingQty) return { ok: false, errorKey: "returnExceedsQty" };

  const remainingSale = remainingRefundableAmount(input.sale);
  if (refund > remainingSale) return { ok: false, errorKey: "returnExceedsRemaining" };

  const lineCap = remainingRefundableForLineQty(
    input.sale,
    input.productId,
    qty,
    input.returnRecords,
  );
  if (refund > lineCap) return { ok: false, errorKey: "returnExceedsLine" };

  return { ok: true };
}
