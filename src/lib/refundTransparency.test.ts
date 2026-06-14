import { describe, expect, it } from "vitest";
import type { Sale, SaleLine } from "../types";
import { buildLineRefundBreakdown } from "./refundBreakdown";
import { computeSaleDiscountBreakdown } from "./discountBreakdown";
import { suggestReturnRefundUgx } from "./returnLimits";
import { buildRefundActivityStats } from "./refundActivityStats";

function pepesSale(): Sale {
  const saleLine: SaleLine = {
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
    lines: [saleLine],
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
  };
}

describe("refundTransparency — formulas unchanged", () => {
  it("breakdown customer paid matches suggestReturnRefundUgx exactly", () => {
    const s = pepesSale();
    const suggested = suggestReturnRefundUgx(s, "pepes", 1, []);
    const bd = buildLineRefundBreakdown({ sale: s, productId: "pepes", returnQty: 1, returnRecords: [] });
    expect(suggested).toBe(714);
    expect(bd!.customerPaidUgx).toBe(suggested);
    expect(bd!.refundAmountUgx).toBe(suggested);
  });

  it("sale discount breakdown reconciles with 714 cart discount scenario", () => {
    const s = pepesSale();
    const disc = computeSaleDiscountBreakdown(s);
    expect(disc.listSubtotalUgx).toBe(1000);
    expect(disc.cartDiscountUgx).toBe(286);
    expect(disc.finalTotalUgx).toBe(714);
    expect(disc.listSubtotalUgx - disc.cartDiscountUgx).toBe(714);
  });

  it("714 scenario displays cart discount allocation in breakdown", () => {
    const bd = buildLineRefundBreakdown({
      sale: pepesSale(),
      productId: "pepes",
      returnQty: 1,
      returnRecords: [],
    });
    expect(bd!.cartDiscountAllocationUgx).toBe(286);
    expect(bd!.customerPaidUgx).toBe(714);
  });
});

describe("refundTransparency — owner activity stats", () => {
  it("aggregates today returns read-only", () => {
    const stats = buildRefundActivityStats(
      [
        {
          id: "r1",
          saleId: "s1",
          productId: "pepes",
          productName: "Pepes",
          quantity: 1,
          refundAmountUgx: 714,
          reason: "damaged",
          actorUserId: "u1",
          actorName: "Jane",
          createdAt: "2026-06-11T12:00:00.000Z",
        },
      ],
      "2026-06-11",
    );
    expect(stats.countToday).toBe(1);
    expect(stats.valueTodayUgx).toBe(714);
    expect(stats.topStaff[0]?.label).toBe("Jane");
    expect(stats.topProducts[0]?.name).toBe("Pepes");
  });
});
