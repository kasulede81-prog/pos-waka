/**
 * Read-only refund transparency — uses returnLimits outputs; does not alter formulas.
 */

import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import { computeSaleDiscountBreakdown } from "./discountBreakdown";
import { activeLines, lineDiscountUgx, listPriceForLine } from "./saleAdjustments";
import { formatQuantityWithFractions } from "./formatQuantityWithFractions";
import { formatSaleLineQuantity, resolveSaleLineQuantity } from "./saleQuantityLabel";
import {
  activeSaleLine,
  originalLinePaidUgx,
  originalSaleTotalUgx,
  refundsOnProduct,
  remainingRefundableAmount,
  remainingReturnableQuantity,
  suggestReturnRefundUgx,
} from "./returnLimits";

export type LineRefundBreakdown = {
  productId: string;
  productName: string;
  quantitySold: number;
  quantityReturning: number;
  /** Human-readable qty labels when product context is available */
  quantitySoldLabel?: string;
  quantityReturningLabel?: string;
  listPriceUgx: number;
  lineDiscountUgx: number;
  cartDiscountAllocationUgx: number;
  customerPaidUgx: number;
  previouslyRefundedUgx: number;
  remainingRefundableUgx: number;
  refundAmountUgx: number;
  saleRoundingRemainderUgx: number;
};

export type ReturnRefundTrace = {
  returnId: string;
  productName: string;
  quantity: number;
  reason: string;
  actorLabel: string;
  createdAt: string;
  originalSaleTotalUgx: number;
  saleDiscountBreakdown: ReturnType<typeof computeSaleDiscountBreakdown>;
  priorRefundsUgx: number;
  currentRefundUgx: number;
  remainingBalanceUgx: number;
  lineBreakdown: LineRefundBreakdown | null;
};

function scaleToQty(lineTotal: number, lineQty: number, returnQty: number): number {
  if (lineQty <= 0 || returnQty <= 0) return 0;
  return Math.round((lineTotal / lineQty) * returnQty);
}

/** Unallocated UGX from proportional rounding across lines (read-only diagnostic). */
export function saleRefundRoundingRemainderUgx(sale: Sale, returnRecords: ReturnRecord[]): number {
  const lines = activeLines(sale);
  const originalTotal = originalSaleTotalUgx(sale, returnRecords);
  const sumLinePaid = lines.reduce(
    (a, l) => a + originalLinePaidUgx(sale, l.productId, returnRecords),
    0,
  );
  return Math.max(0, originalTotal - sumLinePaid);
}

export type SaleLineCustomerPaid = {
  productId: string;
  listPriceUgx: number;
  customerPaidUgx: number;
  /** True when list ≠ paid (cart or line discount). */
  showPaidBreakdown: boolean;
};

/** Customer-paid for a sale line — uses originalLinePaidUgx (same as refund engine). */
export function customerPaidUgxForSaleLine(
  sale: Sale,
  line: SaleLine,
  returnRecords: ReturnRecord[] = [],
): SaleLineCustomerPaid {
  if (line.voided) {
    return {
      productId: line.productId,
      listPriceUgx: listPriceForLine(line),
      customerPaidUgx: 0,
      showPaidBreakdown: false,
    };
  }
  const listPriceUgx = listPriceForLine(line);
  const customerPaidUgx = originalLinePaidUgx(sale, line.productId, returnRecords);
  return {
    productId: line.productId,
    listPriceUgx,
    customerPaidUgx,
    showPaidBreakdown: listPriceUgx !== customerPaidUgx,
  };
}

export type RefundDisplaySurface = {
  surface: string;
  listPriceUgx: number | null;
  customerPaidUgx: number | null;
  refundUgx: number | null;
};

/** Read-only consistency report for Part 5 audit. */
export function buildRefundDisplayConsistencyReport(input: {
  sale: Sale;
  productId: string;
  returnQty: number;
  returnRecords: ReturnRecord[];
  finalRefundUgx: number;
}): RefundDisplaySurface[] {
  const line = activeSaleLine(input.sale, input.productId);
  if (!line) return [];
  const paid = customerPaidUgxForSaleLine(input.sale, line, input.returnRecords);
  const breakdown = buildLineRefundBreakdown({
    sale: input.sale,
    productId: input.productId,
    returnQty: input.returnQty,
    returnRecords: input.returnRecords,
    finalRefundUgx: input.finalRefundUgx,
  });
  return [
    {
      surface: "sales_history",
      listPriceUgx: paid.listPriceUgx,
      customerPaidUgx: paid.customerPaidUgx,
      refundUgx: null,
    },
    {
      surface: "return_modal",
      listPriceUgx: breakdown?.listPriceUgx ?? null,
      customerPaidUgx: breakdown?.customerPaidUgx ?? null,
      refundUgx: breakdown?.refundAmountUgx ?? null,
    },
    {
      surface: "return_receipt",
      listPriceUgx: breakdown?.listPriceUgx ?? null,
      customerPaidUgx: breakdown?.customerPaidUgx ?? null,
      refundUgx: input.finalRefundUgx,
    },
  ];
}

/** Breakdown for linked return modal — refund amount uses suggestReturnRefundUgx unchanged. */
export function buildLineRefundBreakdown(input: {
  sale: Sale;
  productId: string;
  returnQty: number;
  returnRecords: ReturnRecord[];
  finalRefundUgx?: number;
  product?: Product;
}): LineRefundBreakdown | null {
  const line = activeSaleLine(input.sale, input.productId);
  if (!line) return null;

  const qty = Math.max(0, Number(input.returnQty) || 0);
  if (qty <= 0) return null;

  const returnableQty = remainingReturnableQuantity(
    input.sale,
    input.productId,
    input.returnRecords,
  );
  const effectiveQty = Math.min(qty, returnableQty);
  if (effectiveQty <= 0) return null;

  const listForQty = scaleToQty(listPriceForLine(line), line.quantity, effectiveQty);
  const lineDiscForQty = scaleToQty(lineDiscountUgx(line), line.quantity, effectiveQty);
  const lineTotalForQty = scaleToQty(line.lineTotalUgx, line.quantity, effectiveQty);

  const customerPaidUgx = suggestReturnRefundUgx(
    input.sale,
    input.productId,
    effectiveQty,
    input.returnRecords,
  );
  const cartDiscountAllocationUgx = Math.max(0, lineTotalForQty - customerPaidUgx);

  const linePaidTotal = originalLinePaidUgx(input.sale, input.productId, input.returnRecords);
  const previouslyRefundedUgx = refundsOnProduct(
    input.returnRecords,
    input.sale.id,
    input.productId,
  );

  return {
    productId: input.productId,
    productName: line.name,
    quantitySold: resolveSaleLineQuantity(line),
    quantityReturning: effectiveQty,
    quantitySoldLabel: input.product ? formatSaleLineQuantity(line, input.product) : undefined,
    quantityReturningLabel: input.product
      ? formatQuantityWithFractions(effectiveQty, input.product.baseUnit || "item")
      : undefined,
    listPriceUgx: listForQty,
    lineDiscountUgx: lineDiscForQty,
    cartDiscountAllocationUgx: cartDiscountAllocationUgx,
    customerPaidUgx,
    previouslyRefundedUgx,
    remainingRefundableUgx: Math.max(0, linePaidTotal - previouslyRefundedUgx),
    refundAmountUgx: input.finalRefundUgx ?? customerPaidUgx,
    saleRoundingRemainderUgx: saleRefundRoundingRemainderUgx(input.sale, input.returnRecords),
  };
}

/** Read-only trace for a saved return record. */
export function buildReturnRefundTrace(input: {
  sale: Sale;
  returnRecord: ReturnRecord;
  returnRecords: ReturnRecord[];
  actorLabel: string;
}): ReturnRefundTrace {
  const { sale, returnRecord } = input;
  const saleReturns = input.returnRecords.filter((r) => r.saleId === sale.id);
  const originalTotal = originalSaleTotalUgx(sale, saleReturns);
  const pseudoSale: Sale = { ...sale, totalUgx: originalTotal };
  const priorReturns = saleReturns.filter(
    (r) => r.id !== returnRecord.id && r.createdAt < returnRecord.createdAt,
  );
  const priorRefundsUgx = priorReturns.reduce(
    (a, r) => a + Math.max(0, Math.floor(r.refundAmountUgx)),
    0,
  );

  const lineBreakdown = buildLineRefundBreakdown({
    sale: pseudoSale,
    productId: returnRecord.productId,
    returnQty: returnRecord.quantity,
    returnRecords: priorReturns,
    finalRefundUgx: returnRecord.refundAmountUgx,
  });

  return {
    returnId: returnRecord.id,
    productName: returnRecord.productName,
    quantity: returnRecord.quantity,
    reason: returnRecord.reason,
    actorLabel: input.actorLabel,
    createdAt: returnRecord.createdAt,
    originalSaleTotalUgx: originalTotal,
    saleDiscountBreakdown: computeSaleDiscountBreakdown(pseudoSale),
    priorRefundsUgx,
    currentRefundUgx: returnRecord.refundAmountUgx,
    remainingBalanceUgx: remainingRefundableAmount(sale),
    lineBreakdown,
  };
}
