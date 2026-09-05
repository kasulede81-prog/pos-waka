import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { isLowStock } from "./sellingEngine";
import { inventoryValueAtCostUgx } from "./costPrecision";
import { localGetInventoryInsights } from "./localReporting";
import {
  computeInventoryWorkspaceDashboardStats,
  countInventoryStockStatus,
} from "./inventoryWorkspaceStats";

function product(partial: Partial<Product> & Pick<Product, "id" | "name" | "stockOnHand" | "minimumStockAlert">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 2_000,
    costPricePerUnitUgx: 1_000,
    category: "General",
    sku: partial.id,
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    ...partial,
  };
}

describe("countInventoryStockStatus", () => {
  it("uses isLowStock including zero-stock when a threshold exists", () => {
    const products = [
      product({ id: "ok", name: "Ok", stockOnHand: 10, minimumStockAlert: 2 }),
      product({ id: "low", name: "Low", stockOnHand: 1, minimumStockAlert: 2 }),
      product({ id: "zero-alert", name: "Zero alert", stockOnHand: 0, minimumStockAlert: 2 }),
      product({ id: "zero-none", name: "Zero none", stockOnHand: 0, minimumStockAlert: 0 }),
    ];
    const counts = countInventoryStockStatus(products);
    expect(counts.lowStockCount).toBe(products.filter((p) => isLowStock(p)).length);
    expect(counts.lowStockCount).toBe(2);
    expect(counts.outOfStockCount).toBe(2);
    expect(counts.restockAttentionCount).toBe(3);
  });

  it("does not cap low or out counts the way insight preview lists do", () => {
    const products = Array.from({ length: 25 }, (_, i) =>
      product({
        id: `low-${i}`,
        name: `Low ${i}`,
        stockOnHand: 1,
        minimumStockAlert: 2,
      }),
    ).concat(
      Array.from({ length: 35 }, (_, i) =>
        product({
          id: `out-${i}`,
          name: `Out ${i}`,
          stockOnHand: 0,
          minimumStockAlert: 0,
        }),
      ),
    );
    const counts = countInventoryStockStatus(products);
    const insights = localGetInventoryInsights(products);
    expect(insights.lowStock.length).toBe(20);
    expect(insights.outOfStock.length).toBe(30);
    expect(counts.lowStockCount).toBe(25);
    expect(counts.outOfStockCount).toBe(35);
  });
});

describe("computeInventoryWorkspaceDashboardStats product KPIs", () => {
  it("matches Products-tab counts on the same catalog and keeps inventoryValueAtCostUgx", () => {
    const catalog = [
      product({ id: "a", name: "A", stockOnHand: 8, minimumStockAlert: 2, costPricePerUnitUgx: 500 }),
      product({ id: "b", name: "B", stockOnHand: 1, minimumStockAlert: 3, costPricePerUnitUgx: 400 }),
      product({ id: "c", name: "C", stockOnHand: 0, minimumStockAlert: 2, costPricePerUnitUgx: 100 }),
    ];
    const lockedExtra = product({
      id: "locked",
      name: "Locked",
      stockOnHand: 4,
      minimumStockAlert: 5,
      costPricePerUnitUgx: 9_000,
    });
    const all = [...catalog, lockedExtra];
    const stats = computeInventoryWorkspaceDashboardStats({
      products: all,
      catalogProducts: catalog,
      purchases: [],
      supplierPayments: [],
      suppliers: [],
      businessType: "kiosk_duka",
    });
    const productsTab = countInventoryStockStatus(catalog);
    expect(stats.totalProducts).toBe(catalog.length);
    expect(stats.lowStockCount).toBe(productsTab.lowStockCount);
    expect(stats.outOfStockCount).toBe(productsTab.outOfStockCount);
    expect(stats.inventoryValueUgx).toBe(inventoryValueAtCostUgx(catalog));
    expect(stats.inventoryValueUgx).not.toBe(inventoryValueAtCostUgx(all));
  });
});
