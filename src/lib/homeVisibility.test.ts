import { describe, expect, it } from "vitest";
import type { ReturnRecord, Sale } from "../types";
import {
  filterReturnsForHomeScope,
  filterSalesForHomeScope,
  resolveVisibleHomeMetrics,
} from "./homeVisibility";

function sale(id: string, userId: string, total = 1000): Sale {
  return {
    id,
    lines: [],
    totalUgx: total,
    subtotalUgx: total,
    cashPaidUgx: total,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    paymentMethod: "cash",
    createdAt: "2026-06-01T10:00:00.000Z",
    soldByUserId: userId,
    status: "completed",
    updatedAt: "2026-06-01T10:00:00.000Z",
    pendingSync: false,
  };
}

describe("resolveVisibleHomeMetrics", () => {
  it("owner sees shop-wide metrics", () => {
    const m = resolveVisibleHomeMetrics("owner");
    expect(m.scope).toBe("shop_wide");
    expect(m.showShopWideRevenue).toBe(true);
    expect(m.showPersonalRevenue).toBe(false);
  });

  it("cashier sees personal revenue only", () => {
    const m = resolveVisibleHomeMetrics("cashier");
    expect(m.scope).toBe("personal");
    expect(m.showShopWideRevenue).toBe(false);
    expect(m.showPersonalRevenue).toBe(true);
    expect(m.showShopWideDebt).toBe(false);
  });

  it("waiter sees personal revenue only", () => {
    const m = resolveVisibleHomeMetrics("waiter");
    expect(m.scope).toBe("personal");
    expect(m.showPersonalRevenue).toBe(true);
  });

  it("stock keeper sees inventory metrics only", () => {
    const m = resolveVisibleHomeMetrics("stock_keeper");
    expect(m.scope).toBe("inventory");
    expect(m.showShopWideRevenue).toBe(false);
    expect(m.showInventoryMetrics).toBe(true);
    expect(m.showRecentSalesList).toBe(false);
  });
});

describe("filterSalesForHomeScope", () => {
  const sales = [sale("s1", "staff:a"), sale("s2", "staff:b"), sale("s3", "staff:a")];

  it("shop_wide returns all sales", () => {
    expect(filterSalesForHomeScope(sales, "shop_wide", "staff:a")).toHaveLength(3);
  });

  it("personal filters to actor sales", () => {
    expect(filterSalesForHomeScope(sales, "personal", "staff:a")).toHaveLength(2);
    expect(filterSalesForHomeScope(sales, "personal", "staff:b")).toHaveLength(1);
  });

  it("inventory returns no sales", () => {
    expect(filterSalesForHomeScope(sales, "inventory", "staff:a")).toHaveLength(0);
  });
});

describe("filterReturnsForHomeScope", () => {
  const sales = [sale("s1", "staff:a")];
  const returns: ReturnRecord[] = [
    {
      id: "r1",
      saleId: "s1",
      productId: "p1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 500,
      reason: "wrong_item",
      actorUserId: "staff:a",
      createdAt: "2026-06-01T11:00:00.000Z",
    },
    {
      id: "r2",
      saleId: "s-other",
      productId: "p2",
      productName: "Other",
      quantity: 1,
      refundAmountUgx: 200,
      reason: "wrong_item",
      actorUserId: "staff:b",
      createdAt: "2026-06-01T11:00:00.000Z",
    },
  ];

  it("personal scope keeps returns tied to personal sales", () => {
    const scoped = filterReturnsForHomeScope(returns, sales, "personal", "staff:a");
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.id).toBe("r1");
  });
});
