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

/**
 * The line a return/void refers to: the one with `lineId` when given (no fallback — a voided or foreign
 * line id finds nothing), otherwise the product's first active line (the historical behaviour).
 */
export function activeSaleLine(sale: Sale, productId: string, lineId?: string | null): SaleLine | undefined {
  if (lineId) return sale.lines.find((l) => l.id === lineId && l.productId === productId && !l.voided);
  return sale.lines.find((l) => l.productId === productId && !l.voided);
}

/** Records that count against ONE line: those stamped with its id, plus — for the product's first
 *  active line only — legacy records that name no line (they always meant "the first line"). */
function recordsForLine(sale: Sale, line: SaleLine, records: readonly ReturnRecord[]): ReturnRecord[] {
  const first = sale.lines.find((l) => l.productId === line.productId && !l.voided);
  const isFirst = first === line || (first?.id != null && first.id === line.id);
  return records.filter(
    (r) =>
      r.saleId === sale.id &&
      r.productId === line.productId &&
      (r.saleLineId ? r.saleLineId === line.id : isFirst),
  );
}

export function returnedQuantityOnLine(sale: Sale, line: SaleLine, records: readonly ReturnRecord[]): number {
  return recordsForLine(sale, line, records).reduce((sum, r) => sum + Math.max(0, r.quantity), 0);
}

export function refundsOnLine(sale: Sale, line: SaleLine, records: readonly ReturnRecord[]): number {
  return recordsForLine(sale, line, records).reduce((sum, r) => sum + Math.max(0, Math.floor(r.refundAmountUgx)), 0);
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
  lineId?: string | null,
): number {
  const line = activeSaleLine(sale, productId, lineId);
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
  lineId?: string | null,
): number {
  const line = activeSaleLine(sale, productId, lineId);
  if (!line) return 0;
  const already = lineId
    ? returnedQuantityOnLine(sale, line, returnRecords)
    : returnedQuantityOnSale(returnRecords, sale.id, productId);
  return Math.max(0, line.quantity - already - Math.max(0, pendingQty));
}

/** Max refund for a quantity on one line (proportional to what customer paid). */
export function remainingRefundableForLineQty(
  sale: Sale,
  productId: string,
  quantity: number,
  returnRecords: ReturnRecord[],
  lineId?: string | null,
): number {
  const line = activeSaleLine(sale, productId, lineId);
  if (!line || quantity <= 0) return 0;
  const returnableQty = remainingReturnableQuantity(sale, productId, returnRecords, 0, lineId);
  const qty = Math.min(quantity, returnableQty);
  if (qty <= 0) return 0;

  const refunded = lineId ? refundsOnLine(sale, line, returnRecords) : refundsOnProduct(returnRecords, sale.id, productId);
  const returned = lineId ? returnedQuantityOnLine(sale, line, returnRecords) : returnedQuantityOnSale(returnRecords, sale.id, productId);
  const linePaidRemaining = originalLinePaidUgx(sale, productId, returnRecords, lineId) - refunded;
  const remainingLineQty = line.quantity - returned;
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
  lineId?: string | null,
): number {
  return remainingRefundableForLineQty(sale, productId, quantity, returnRecords, lineId);
}

export type RemainingVoidableLine = {
  quantity: number;
  amountUgx: number;
};

/**
 * SALES-VOID-01 — remaining units/value that a void may still take.
 * Returns do not mutate line.quantity / line.lineTotalUgx; subtract ReturnRecords.
 */
export function remainingVoidableLine(
  sale: Sale,
  productId: string,
  returnRecords: readonly ReturnRecord[],
  lineId?: string | null,
): RemainingVoidableLine {
  const records = [...returnRecords];
  const quantity = remainingReturnableQuantity(sale, productId, records, 0, lineId);
  if (quantity <= 0) return { quantity: 0, amountUgx: 0 };
  const lineCap = remainingRefundableForLineQty(sale, productId, quantity, records, lineId);
  const headerCap = remainingRefundableAmount(sale);
  return { quantity, amountUgx: Math.max(0, Math.min(lineCap, headerCap)) };
}

export type ReturnLimitCheck = { ok: true } | { ok: false; errorKey: string };

export function validateReturnAgainstSale(input: {
  sale: Sale;
  productId: string;
  quantity: number;
  refundAmountUgx: number;
  returnRecords: ReturnRecord[];
  /** The sale line being returned from; omitted = the product's first active line (legacy). */
  lineId?: string | null;
}): ReturnLimitCheck {
  const qty = Math.max(0, Number(input.quantity) || 0);
  const refund = Math.max(0, Math.floor(input.refundAmountUgx));
  if (qty <= 0 || refund <= 0) return { ok: false, errorKey: "invalid" };

  const remainingQty = remainingReturnableQuantity(
    input.sale,
    input.productId,
    input.returnRecords,
    0,
    input.lineId,
  );
  if (qty > remainingQty) return { ok: false, errorKey: "returnExceedsQty" };

  const remainingSale = remainingRefundableAmount(input.sale);
  if (refund > remainingSale) return { ok: false, errorKey: "returnExceedsRemaining" };

  const lineCap = remainingRefundableForLineQty(
    input.sale,
    input.productId,
    qty,
    input.returnRecords,
    input.lineId,
  );
  if (refund > lineCap) return { ok: false, errorKey: "returnExceedsLine" };

  return { ok: true };
}
