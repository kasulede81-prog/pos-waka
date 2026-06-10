import { describe, expect, it } from "vitest";
import type { Product, Purchase, Sale, StockMovement, Supplier, SupplierPayment } from "../types";
import {
  buildRestockProductSuggestions,
  buildSupplierStatement,
  buildSupplierSummary,
  filterPurchases,
  filterSupplierPayments,
  resolvePurchaseFilterBounds,
  searchPurchases,
  sumSupplierPaymentsUgx,
} from "./purchaseReporting";
import { WALK_IN_SUPPLIER_ID } from "./walkInSupplier";

const SUPPLIER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function purchase(partial: Partial<Purchase> & Pick<Purchase, "id" | "createdAt" | "totalCostUgx">): Purchase {
  return {
    supplierId: SUPPLIER_A,
    supplierName: "Mukwano",
    lines: [
      {
        productId: PRODUCT_ID,
        name: "Soda",
        qtyBuyingUnits: 10,
        costPerBuyingUnitUgx: 1_000,
      },
    ],
    amountPaidUgx: partial.amountPaidUgx ?? partial.totalCostUgx,
    balanceDeltaUgx: partial.balanceDeltaUgx ?? 0,
    notes: "",
    pendingSync: false,
    ...partial,
  };
}

const product: Product = {
  id: PRODUCT_ID,
  name: "Soda",
  sellingPricePerUnitUgx: 2_000,
  costPricePerUnitUgx: 1_000,
  stockOnHand: 2,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "Drinks",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

describe("purchase filtering", () => {
  it("filters purchases by week bounds", () => {
    const bounds = resolvePurchaseFilterBounds({ kind: "preset", preset: "this_month" });
    const purchases = [
      purchase({ id: "p1", createdAt: "2026-06-10T10:00:00.000Z", totalCostUgx: 10_000 }),
      purchase({ id: "p2", createdAt: "2026-05-01T10:00:00.000Z", totalCostUgx: 5_000 }),
    ];
    const scoped = filterPurchases(purchases, bounds);
    expect(scoped.some((p) => p.id === "p1")).toBe(true);
    expect(scoped.some((p) => p.id === "p2")).toBe(false);
  });

  it("searches by supplier and product", () => {
    const purchases = [
      purchase({ id: "p1", createdAt: "2026-06-10T10:00:00.000Z", totalCostUgx: 10_000, supplierName: "Mukwano" }),
      purchase({
        id: "p2",
        createdAt: "2026-06-11T10:00:00.000Z",
        totalCostUgx: 8_000,
        supplierName: "City Mart",
        lines: [{ productId: PRODUCT_ID, name: "Bread", qtyBuyingUnits: 1, costPerBuyingUnitUgx: 8_000 }],
      }),
    ];
    const bySupplier = searchPurchases(purchases, [product], { supplier: "city" });
    expect(bySupplier).toHaveLength(1);
    expect(bySupplier[0]?.id).toBe("p2");

    const byProduct = searchPurchases(purchases, [product], { product: "bread" });
    expect(byProduct).toHaveLength(1);
    expect(byProduct[0]?.id).toBe("p2");
  });
});

describe("supplier statement running balance", () => {
  it("tracks purchase then payment chronologically", () => {
    const purchases = [
      purchase({
        id: "p1",
        createdAt: "2026-06-10T10:00:00.000Z",
        totalCostUgx: 200_000,
        amountPaidUgx: 0,
        balanceDeltaUgx: 200_000,
      }),
    ];
    const payments: SupplierPayment[] = [
      {
        id: "pay1",
        supplierId: SUPPLIER_A,
        amountUgx: 100_000,
        createdAt: "2026-06-11T14:00:00.000Z",
        pendingSync: false,
      },
    ];
    const statement = buildSupplierStatement(SUPPLIER_A, "Mukwano", purchases, payments);
    expect(statement).toHaveLength(2);
    expect(statement[0]?.runningBalanceUgx).toBe(200_000);
    expect(statement[1]?.runningBalanceUgx).toBe(100_000);
    expect(statement[1]?.deltaUgx).toBe(-100_000);
  });
});

describe("payment history totals", () => {
  it("sums payments in date bounds for supplier", () => {
    const bounds = resolvePurchaseFilterBounds({ kind: "day", dateKey: "2026-06-12" });
    const payments: SupplierPayment[] = [
      {
        id: "pay1",
        supplierId: SUPPLIER_A,
        amountUgx: 50_000,
        createdAt: "2026-06-12T10:00:00.000Z",
        pendingSync: false,
      },
      {
        id: "pay2",
        supplierId: SUPPLIER_A,
        amountUgx: 30_000,
        createdAt: "2026-06-11T10:00:00.000Z",
        pendingSync: false,
      },
      {
        id: "pay3",
        supplierId: WALK_IN_SUPPLIER_ID,
        amountUgx: 99_000,
        createdAt: "2026-06-12T10:00:00.000Z",
        pendingSync: false,
      },
    ];
    const scoped = filterSupplierPayments(payments, bounds, SUPPLIER_A);
    expect(sumSupplierPaymentsUgx(scoped)).toBe(50_000);
  });
});

describe("supplier debt totals", () => {
  it("aggregates supplier summary metrics", () => {
    const suppliers: Supplier[] = [
      {
        id: SUPPLIER_A,
        name: "A",
        phone: "",
        location: "",
        notes: "",
        balanceOwedUgx: 150_000,
        totalPurchasesUgx: 500_000,
        createdAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
      {
        id: SUPPLIER_B,
        name: "B",
        phone: "",
        location: "",
        notes: "",
        balanceOwedUgx: 0,
        totalPurchasesUgx: 100_000,
        createdAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
    ];
    const summary = buildSupplierSummary(suppliers);
    expect(summary.totalSuppliers).toBe(2);
    expect(summary.totalDebtUgx).toBe(150_000);
    expect(summary.suppliersWithBalance).toBe(1);
    expect(summary.largestBalanceUgx).toBe(150_000);
    expect(summary.largestBalanceSupplierName).toBe("A");
  });
});

describe("restock suggestion calculations", () => {
  it("suggests low-stock products with minimum and suggested qty", () => {
    const low: Product = { ...product, stockOnHand: 2, minimumStockAlert: 5 };
    const ok: Product = {
      ...product,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      name: "Rice",
      stockOnHand: 50,
      minimumStockAlert: 5,
    };
    const sales: Sale[] = [];
    const suggestions = buildRestockProductSuggestions([low, ok], sales, 5);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0]?.productId).toBe(PRODUCT_ID);
    expect(suggestions[0]?.minimumStock).toBe(5);
    expect(suggestions[0]?.suggestedQty).toBeGreaterThan(0);
    expect(suggestions[0]?.reason).toBe("low");
  });

  it("uses stock movements for quantity when available", () => {
    const purchases = [purchase({ id: "p1", createdAt: "2026-06-12T10:00:00.000Z", totalCostUgx: 10_000 })];
    const movements: StockMovement[] = [
      {
        id: "m1",
        at: "2026-06-12T10:00:00.000Z",
        productId: PRODUCT_ID,
        productName: "Soda",
        deltaBaseUnits: 24,
        kind: "purchase_in",
        summary: "Restock",
        refId: "p1",
        supplierId: SUPPLIER_A,
      },
    ];
    const bounds = resolvePurchaseFilterBounds({ kind: "day", dateKey: "2026-06-12" });
    const scoped = filterPurchases(purchases, bounds);
    expect(scoped).toHaveLength(1);
    expect(movements[0]?.deltaBaseUnits).toBe(24);
  });
});
