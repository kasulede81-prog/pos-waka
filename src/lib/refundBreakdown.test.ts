import { describe, expect, it } from "vitest";
import type { ReturnRecord, Sale, SaleLine } from "../types";
import {
  buildLineRefundBreakdown,
  buildReturnRefundTrace,
  saleRefundRoundingRemainderUgx,
} from "./refundBreakdown";
import { suggestReturnRefundUgx } from "./returnLimits";

const SALE_ID = "sale-pepes";

function mkLine(
  productId: string,
  name: string,
  quantity: number,
  lineTotal: number,
  list?: number,
): SaleLine {
  const listPrice = list ?? lineTotal;
  return {
    id: `line-${productId}`,
    productId,
    name,
    quantity,
    unitPriceUgx: listPrice / quantity,
    unitCostUgx: 100,
    lineTotalUgx: lineTotal,
    originalLineTotalUgx: listPrice !== lineTotal ? listPrice : undefined,
    discountUgx: listPrice > lineTotal ? listPrice - lineTotal : undefined,
    estimatedProfitUgx: lineTotal - quantity * 100,
    inputMode: "quantity",
  };
}

function mkSale(total: number, lines: SaleLine[]): Sale {
  return {
    id: SALE_ID,
    status: "completed",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    subtotalUgx: lines.reduce((a, l) => a + l.lineTotalUgx, 0),
    totalUgx: total,
    cashPaidUgx: total,
    debtUgx: 0,
    estimatedProfitUgx: 500,
    lines,
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
  };
}

describe("refundBreakdown — Pepes 714", () => {
  it("line discount: list 1000, paid 714", () => {
    const s = mkSale(714, [mkLine("pepes", "Pepes", 1, 714, 1000)]);
    const bd = buildLineRefundBreakdown({ sale: s, productId: "pepes", returnQty: 1, returnRecords: [] });
    expect(bd).not.toBeNull();
    expect(bd!.listPriceUgx).toBe(1000);
    expect(bd!.lineDiscountUgx).toBe(286);
    expect(bd!.cartDiscountAllocationUgx).toBe(0);
    expect(bd!.customerPaidUgx).toBe(714);
    expect(bd!.refundAmountUgx).toBe(714);
    expect(bd!.customerPaidUgx).toBe(suggestReturnRefundUgx(s, "pepes", 1, []));
  });

  it("cart discount: list 1000 line, sale 714", () => {
    const s = mkSale(714, [mkLine("pepes", "Pepes", 1, 1000, 1000)]);
    const bd = buildLineRefundBreakdown({ sale: s, productId: "pepes", returnQty: 1, returnRecords: [] });
    expect(bd!.listPriceUgx).toBe(1000);
    expect(bd!.lineDiscountUgx).toBe(0);
    expect(bd!.cartDiscountAllocationUgx).toBe(286);
    expect(bd!.customerPaidUgx).toBe(714);
    expect(bd!.refundAmountUgx).toBe(714);
  });
});

describe("refundBreakdown — rounding remainder", () => {
  it("detects 1 UGX dust on three-line cart discount sale", () => {
    const s = mkSale(8000, [
      mkLine("a", "A", 1, 3333, 3333),
      mkLine("b", "B", 1, 3333, 3333),
      mkLine("c", "C", 1, 3334, 3334),
    ]);
    expect(saleRefundRoundingRemainderUgx(s, [])).toBe(1);
  });
});

describe("refundBreakdown — return trace", () => {
  it("reconciles prior refunds and current refund", () => {
    const multi = mkSale(8000, [
      mkLine("pepes", "Pepes", 2, 6000, 6000),
      mkLine("other", "Other", 1, 4000, 4000),
    ]);
    const first: ReturnRecord = {
      id: "r1",
      saleId: SALE_ID,
      productId: "pepes",
      productName: "Pepes",
      quantity: 1,
      refundAmountUgx: 2400,
      reason: "damaged",
      actorUserId: "u1",
      actorName: "Jane",
      createdAt: "2026-06-11T11:00:00.000Z",
    };
    const after = { ...multi, totalUgx: 5600, cashPaidUgx: 5600 };
    const trace = buildReturnRefundTrace({
      sale: after,
      returnRecord: first,
      returnRecords: [first],
      actorLabel: "Jane",
    });
    expect(trace.originalSaleTotalUgx).toBe(8000);
    expect(trace.priorRefundsUgx).toBe(0);
    expect(trace.currentRefundUgx).toBe(2400);
    expect(trace.lineBreakdown?.customerPaidUgx).toBe(2400);
  });
});
