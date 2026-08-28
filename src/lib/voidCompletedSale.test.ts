import { describe, expect, it } from "vitest";
import type { Customer, Product, Sale, SaleLine } from "../types";
import { isRevenueSale } from "./saleStatus";
import { planWholeBillVoid } from "./voidCompletedSale";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const line: SaleLine = {
  id: "line-1",
  productId: PRODUCT_ID,
  name: "Meal",
  inputMode: "quantity",
  quantity: 2,
  unitPriceUgx: 10_000,
  unitCostUgx: 3_000,
  lineTotalUgx: 20_000,
  estimatedProfitUgx: 14_000,
  updatedAt: "2026-06-02T10:00:00.000Z",
};

function product(stockOnHand: number): Product {
  return {
    id: PRODUCT_ID,
    name: "Meal",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 2,
    updatedAt: "2026-06-02T09:00:00.000Z",
    version: 1,
  };
}

function customer(debtBalanceUgx: number): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Jane",
    phone: "",
    location: "",
    debtBalanceUgx,
    createdAt: "2026-06-02T08:00:00.000Z",
    version: 1,
  };
}

function completedSale(partial?: Partial<Sale>): Sale {
  return {
    id: SALE_ID,
    status: "completed",
    createdAt: "2026-06-02T10:00:00.000Z",
    updatedAt: "2026-06-02T10:00:00.000Z",
    subtotalUgx: 20_000,
    totalUgx: 20_000,
    cashPaidUgx: 15_000,
    debtUgx: 5_000,
    estimatedProfitUgx: 14_000,
    lines: [line],
    customerId: CUSTOMER_ID,
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

describe("planWholeBillVoid", () => {
  it("restores stock, cash, and debt once and excludes the sale from revenue", () => {
    const first = planWholeBillVoid({
      sale: completedSale(),
      products: [product(8)],
      customers: [customer(5_000)],
      shopKey: "shop:test",
      at: "2026-06-02T12:00:00.000Z",
      reason: "other",
      note: "wrong table",
      actorUserId: "owner:1",
      actorName: "Owner",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.plan.products[0]!.stockOnHand).toBe(10);
    expect(first.plan.customers[0]!.debtBalanceUgx).toBe(0);
    expect(first.plan.cashReduce).toBe(15_000);
    expect(first.plan.sale.saleVoidedAt).toBe("2026-06-02T12:00:00.000Z");
    expect(first.plan.sale.lines[0]!.voided).toBe(true);
    expect(isRevenueSale(first.plan.sale)).toBe(false);
    expect(first.plan.movements).toHaveLength(1);
    expect(first.plan.voidRecords).toHaveLength(1);

    const replay = planWholeBillVoid({
      sale: first.plan.sale,
      products: first.plan.products,
      customers: first.plan.customers,
      shopKey: "shop:test",
      at: "2026-06-02T12:01:00.000Z",
      reason: "other",
      note: "wrong table",
      actorUserId: "owner:1",
    });
    expect(replay.ok).toBe(false);
  });

  it("rejects pending sales", () => {
    const r = planWholeBillVoid({
      sale: completedSale({ status: "pending" }),
      products: [product(8)],
      customers: [customer(0)],
      shopKey: "shop:test",
      at: "2026-06-02T12:00:00.000Z",
      reason: "other",
      note: "no",
      actorUserId: "owner:1",
    });
    expect(r.ok).toBe(false);
  });
});
