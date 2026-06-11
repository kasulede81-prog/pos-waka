/**
 * Return / refund ceilings — prevent money creation via over-refund.
 */

import { activeLines } from "./saleAdjustments";
import type { ReturnRecord, Sale, SaleLine } from "../types";

export function refundsOnSale(returnRecords: ReturnRecord[], saleId: string): number {
  return returnRecords
    .filter((r) => r.saleId === saleId)
    .reduce((sum, r) => sum + Math.max(0, Math.floor(r.refundAmountUgx)), 0);
}

export function refundsOnProduct(
  returnRecords: ReturnRecord[],
  saleId: string,
  productId: string,
): number {
  return returnRecords
    .filter((r) => r.saleId === saleId && r.productId === productId)
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

/** Sale total before linked returns (header is reduced after each return). */
export function originalSaleTotalUgx(sale: Sale, returnRecords: ReturnRecord[]): number {
  return Math.max(0, Math.floor(sale.totalUgx) + refundsOnSale(returnRecords, sale.id));
}

/** What the customer originally paid for this line (cart + line discounts included). */
export function originalLinePaidUgx(
  sale: Sale,
  productId: string,
  returnRecords: ReturnRecord[],
): number {
  const line = activeSaleLine(sale, productId);
  if (!line) return 0;
  const lines = activeLines(sale);
  const lineSubtotal = lines.reduce((a, l) => a + l.lineTotalUgx, 0);
  if (lineSubtotal <= 0) return 0;
  const originalTotal = originalSaleTotalUgx(sale, returnRecords);
  return Math.round((line.lineTotalUgx / lineSubtotal) * originalTotal);
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

/** Max refund for a quantity on one line (proportional to what customer paid). */
export function remainingRefundableForLineQty(
  sale: Sale,
  productId: string,
  quantity: number,
  returnRecords: ReturnRecord[],
): number {
  const line = activeSaleLine(sale, productId);
  if (!line || quantity <= 0) return 0;
  const returnableQty = remainingReturnableQuantity(sale, productId, returnRecords);
  const qty = Math.min(quantity, returnableQty);
  if (qty <= 0) return 0;

  const linePaidRemaining =
    originalLinePaidUgx(sale, productId, returnRecords) -
    refundsOnProduct(returnRecords, sale.id, productId);
  const remainingLineQty = line.quantity - returnedQuantityOnSale(returnRecords, sale.id, productId);
  if (remainingLineQty <= 0 || linePaidRemaining <= 0) return 0;

  const cap = Math.round((linePaidRemaining / remainingLineQty) * qty);
  return Math.max(0, Math.min(cap, linePaidRemaining));
}

/** Suggested refund for a return qty (same as line cap). */
export function suggestReturnRefundUgx(
  sale: Sale,
  productId: string,
  quantity: number,
  returnRecords: ReturnRecord[],
): number {
  return remainingRefundableForLineQty(sale, productId, quantity, returnRecords);
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
