import { describe, expect, it } from "vitest";
import type { Sale, SaleLine } from "../types";
import { computeSaleDiscountBreakdown } from "./discountBreakdown";

function line(overrides: Partial<SaleLine> & Pick<SaleLine, "lineTotalUgx">): SaleLine {
  return {
    id: "l1",
    productId: "p1",
    name: "Item",
    quantity: 1,
    unitPriceUgx: overrides.lineTotalUgx,
    unitCostUgx: 1_000,
    inputMode: "quantity",
    estimatedProfitUgx: overrides.lineTotalUgx - 1_000,
    ...overrides,
  };
}

function sale(lines: SaleLine[], cartDiscount = 0): Sale {
  const lineSubtotal = lines.reduce((a, l) => a + l.lineTotalUgx, 0);
  const listSubtotal = lines.reduce((a, l) => a + (l.originalLineTotalUgx ?? l.lineTotalUgx), 0);
  const total = Math.max(0, lineSubtotal - cartDiscount);
  return {
    id: "s1",
    status: "completed",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    lines,
    subtotalUgx: listSubtotal,
    totalUgx: total,
    cashPaidUgx: total,
    debtUgx: 0,
    discountTotalUgx: listSubtotal - total,
    estimatedProfitUgx: 0,
    pendingSync: false,
  };
}

describe("discount breakdown", () => {
  it("reconciles line + cart discounts with final total", () => {
    const lines = [
      line({ lineTotalUgx: 8_000, originalLineTotalUgx: 10_000, discountUgx: 2_000 }),
      line({ id: "l2", lineTotalUgx: 5_000 }),
    ];
    const s = sale(lines, 1_000);
    const b = computeSaleDiscountBreakdown(s);
    expect(b.lineDiscountsUgx).toBe(2_000);
    expect(b.cartDiscountUgx).toBe(1_000);
    expect(b.totalDiscountUgx).toBe(3_000);
    expect(b.listSubtotalUgx - b.lineDiscountsUgx - b.cartDiscountUgx).toBe(b.finalTotalUgx);
  });

  it("handles sale with no discounts", () => {
    const s = sale([line({ lineTotalUgx: 5_000 })], 0);
    const b = computeSaleDiscountBreakdown(s);
    expect(b.totalDiscountUgx).toBe(0);
    expect(b.finalTotalUgx).toBe(5_000);
  });
});
