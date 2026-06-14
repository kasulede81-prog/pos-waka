import { describe, expect, it } from "vitest";
import type { ReturnRecord, Sale, SaleLine } from "../types";
import { auditRefundIntegrity } from "./auditRefundIntegrity";

function sale(id: string, total: number, lines: SaleLine[]): Sale {
  return {
    id,
    status: "completed",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    subtotalUgx: total,
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

function line(productId: string, qty: number, lineTotal: number): SaleLine {
  return {
    id: `line-${productId}`,
    productId,
    name: productId,
    quantity: qty,
    unitPriceUgx: lineTotal / qty,
    unitCostUgx: 100,
    lineTotalUgx: lineTotal,
    estimatedProfitUgx: lineTotal - qty * 100,
    inputMode: "quantity",
  };
}

function returnRec(
  id: string,
  saleId: string,
  productId: string,
  qty: number,
  refund: number,
): ReturnRecord {
  return {
    id,
    saleId,
    productId,
    productName: productId,
    quantity: qty,
    refundAmountUgx: refund,
    reason: "damaged",
    actorUserId: "u1",
    createdAt: "2026-06-11T11:00:00.000Z",
  };
}

describe("auditRefundIntegrity", () => {
  it("passes clean sales and returns", () => {
    const s = sale("s1", 5000, [line("p1", 1, 5000)]);
    const returns = [returnRec("r1", "s1", "p1", 1, 2000)];
    const adjusted = { ...s, totalUgx: 3000, cashPaidUgx: 3000 };
    const report = auditRefundIntegrity({ sales: [adjusted], returnRecords: returns });
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it("flags over-refund on sale", () => {
    const s = sale("s1", 5000, [line("p1", 1, 5000)]);
    const returns = [returnRec("r1", "s1", "p1", 1, 6000)];
    const report = auditRefundIntegrity({ sales: [s], returnRecords: returns });
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.code === "over_refund_sale")).toBe(true);
  });

  it("flags over-return quantity", () => {
    const s = sale("s1", 5000, [line("p1", 2, 5000)]);
    const returns = [returnRec("r1", "s1", "p1", 3, 5000)];
    const report = auditRefundIntegrity({ sales: [s], returnRecords: returns });
    expect(report.violations.some((v) => v.code === "over_return_qty")).toBe(true);
  });

  it("flags duplicate return ids", () => {
    const r = returnRec("r1", "s1", "p1", 1, 1000);
    const s = sale("s1", 5000, [line("p1", 1, 5000)]);
    const report = auditRefundIntegrity({ sales: [s], returnRecords: [r, r] });
    expect(report.violations.some((v) => v.code === "duplicate_return_id")).toBe(true);
  });

  it("flags negative refund amount", () => {
    const r = returnRec("r1", "s1", "p1", 1, -100);
    const s = sale("s1", 5000, [line("p1", 1, 5000)]);
    const report = auditRefundIntegrity({ sales: [s], returnRecords: [r] });
    expect(report.violations.some((v) => v.code === "negative_refund")).toBe(true);
  });
});
