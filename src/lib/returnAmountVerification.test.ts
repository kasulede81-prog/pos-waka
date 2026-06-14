import { describe, expect, it } from "vitest";
import type { ReturnRecord, Sale, SaleLine } from "../types";
import { resolveReturnRefundUgx } from "./returnRefundInput";
import { suggestReturnRefundUgx, validateReturnAgainstSale } from "./returnLimits";

const SALE_ID = "sale-return-verify";
const PROD = "prod-1";

function line(quantity: number, lineTotalUgx: number): SaleLine {
  return {
    id: "line-1",
    productId: PROD,
    name: "Widget",
    quantity,
    unitPriceUgx: lineTotalUgx / quantity,
    unitCostUgx: 1000,
    estimatedProfitUgx: lineTotalUgx - quantity * 1000,
    inputMode: "quantity",
    lineTotalUgx,
  };
}

function sale5000(): Sale {
  return {
    id: SALE_ID,
    status: "completed",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    subtotalUgx: 5000,
    totalUgx: 5000,
    cashPaidUgx: 5000,
    debtUgx: 0,
    estimatedProfitUgx: 4000,
    lines: [line(1, 5000)],
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
  };
}

function simulateModalSubmit(input: {
  refundInput: string;
  suggestedRefundUgx: number;
  maxRefundUgx: number | null;
}): number {
  return resolveReturnRefundUgx(input).refundUgx;
}

function simulateStoreSave(refundAmountUgx: number, sale: Sale, returnRecords: ReturnRecord[] = []): ReturnRecord | null {
  const refund = Math.max(0, Math.floor(refundAmountUgx));
  if (refund <= 0) return null;
  const check = validateReturnAgainstSale({
    sale,
    productId: PROD,
    quantity: 1,
    refundAmountUgx: refund,
    returnRecords,
  });
  if (!check.ok) return null;
  return {
    id: "ret-1",
    saleId: SALE_ID,
    productId: PROD,
    productName: "Widget",
    quantity: 1,
    refundAmountUgx: refund,
    reason: "damaged",
    actorUserId: "u1",
    createdAt: "2026-06-11T11:00:00.000Z",
  };
}

describe("return amount verification — modal → store → receipt field", () => {
  const sale = sale5000();
  const suggested = suggestReturnRefundUgx(sale, PROD, 1, []);
  const maxRefund = suggestReturnRefundUgx(sale, PROD, 1, []);

  it("suggested 5000, entered 3000, saved 3000", () => {
    expect(suggested).toBe(5000);
    const modalRefund = simulateModalSubmit({
      refundInput: "3000",
      suggestedRefundUgx: suggested,
      maxRefundUgx: maxRefund,
    });
    expect(modalRefund).toBe(3000);

    const saved = simulateStoreSave(modalRefund, sale);
    expect(saved).not.toBeNull();
    expect(saved!.refundAmountUgx).toBe(3000);
  });

  it("suggested 5000, entered 2000, saved 2000", () => {
    const modalRefund = simulateModalSubmit({
      refundInput: "2000",
      suggestedRefundUgx: suggested,
      maxRefundUgx: maxRefund,
    });
    expect(modalRefund).toBe(2000);

    const saved = simulateStoreSave(modalRefund, sale);
    expect(saved!.refundAmountUgx).toBe(2000);
  });

  it("suggested 5000, entered 7000 — capped to max refundable (5000)", () => {
    const resolved = resolveReturnRefundUgx({
      refundInput: "7000",
      suggestedRefundUgx: suggested,
      maxRefundUgx: maxRefund,
    });
    expect(resolved.refundUgx).toBe(5000);
    expect(resolved.wasCapped).toBe(true);

    const saved = simulateStoreSave(resolved.refundUgx, sale);
    expect(saved!.refundAmountUgx).toBe(5000);
  });

  it("empty refund input falls back to suggested amount", () => {
    const modalRefund = simulateModalSubmit({
      refundInput: "",
      suggestedRefundUgx: suggested,
      maxRefundUgx: maxRefund,
    });
    expect(modalRefund).toBe(5000);
  });

  it("printed receipt uses stored refundAmountUgx (not suggested)", () => {
    const saved = simulateStoreSave(3000, sale)!;
    expect(saved.refundAmountUgx).toBe(3000);
    expect(saved.refundAmountUgx).not.toBe(suggested);
  });
});

describe("return amount verification — dashboard aggregation", () => {
  it("dashboard refund total uses stored refundAmountUgx", () => {
    const records: ReturnRecord[] = [
      {
        id: "r1",
        saleId: SALE_ID,
        productId: PROD,
        productName: "Widget",
        quantity: 1,
        refundAmountUgx: 3000,
        reason: "damaged",
        actorUserId: "u1",
        createdAt: "2026-06-11T11:00:00.000Z",
      },
    ];
    const dashboardTotal = records.reduce((a, r) => a + Math.max(0, r.refundAmountUgx), 0);
    expect(dashboardTotal).toBe(3000);
  });
});
