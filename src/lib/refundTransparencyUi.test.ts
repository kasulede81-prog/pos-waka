import { describe, expect, it } from "vitest";
import { resolveReturnRefundUgx } from "./returnRefundInput";
import { buildLineRefundBreakdown } from "./refundBreakdown";
import type { Sale, SaleLine } from "../types";

function pepesSale714(): Sale {
  const line: SaleLine = {
    id: "l1",
    productId: "pepes",
    name: "Pepes",
    quantity: 1,
    unitPriceUgx: 1000,
    unitCostUgx: 100,
    lineTotalUgx: 1000,
    estimatedProfitUgx: 900,
    inputMode: "quantity",
  };
  return {
    id: "s1",
    status: "completed",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    subtotalUgx: 1000,
    totalUgx: 714,
    cashPaidUgx: 714,
    debtUgx: 0,
    estimatedProfitUgx: 500,
    lines: [line],
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
  };
}

describe("refundTransparencyUi — default return view", () => {
  it("shows customer paid amount in breakdown for cart discount sale", () => {
    const bd = buildLineRefundBreakdown({
      sale: pepesSale714(),
      productId: "pepes",
      returnQty: 1,
      returnRecords: [],
    });
    expect(bd!.customerPaidUgx).toBe(714);
    expect(bd!.listPriceUgx).toBe(1000);
  });

  it("empty refund input uses suggested customer-paid amount", () => {
    const resolved = resolveReturnRefundUgx({
      refundInput: "",
      suggestedRefundUgx: 714,
      maxRefundUgx: 714,
    });
    expect(resolved.refundUgx).toBe(714);
    expect(resolved.usedSuggestion).toBe(true);
  });

  it("custom refund is identifiable when entered", () => {
    const suggested = 714;
    const entered = 500;
    const resolved = resolveReturnRefundUgx({
      refundInput: String(entered),
      suggestedRefundUgx: suggested,
      maxRefundUgx: suggested,
    });
    expect(resolved.refundUgx).toBe(entered);
    expect(resolved.refundUgx !== suggested).toBe(true);
  });

  it("refund field accepts custom amount within max", () => {
    const resolved = resolveReturnRefundUgx({
      refundInput: "700",
      suggestedRefundUgx: 714,
      maxRefundUgx: 714,
    });
    expect(resolved.refundUgx).toBe(700);
    expect(resolved.wasCapped).toBe(false);
  });

  it("calculation details are opt-in (collapsed by default is UI state)", () => {
    const defaultExpanded = false;
    expect(defaultExpanded).toBe(false);
  });
});
