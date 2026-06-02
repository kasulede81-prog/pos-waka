import { describe, expect, it } from "vitest";
import type { Product, Sale } from "../types";
import { computePharmacyDashboardStats } from "./pharmacyStats";
import { getCompletedFinancials } from "./financialMetrics";
import { dateKeyKampala } from "./datesUg";

const todayKey = dateKeyKampala(new Date("2026-06-02T12:00:00.000Z"));

function product(partial: Partial<Product>): Product {
  return {
    id: "p1",
    name: "Paracetamol",
    sellingMode: "unit",
    baseUnit: "tablet",
    sellingPricePerUnitUgx: 100,
    costPricePerUnitUgx: 50,
    stockOnHand: 20,
    minimumStockAlert: 5,
    category: "Pain",
    sku: "SKU-1",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    ...partial,
  };
}

function completedSale(totalUgx: number, profitUgx: number): Sale {
  return {
    id: crypto.randomUUID(),
    status: "completed",
    createdAt: `${todayKey}T10:00:00.000Z`,
    updatedAt: `${todayKey}T10:00:00.000Z`,
    receiptSeq: 1,
    lines: [
      {
        productId: "p1",
        name: "Paracetamol",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: totalUgx - profitUgx,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: profitUgx,
        inputMode: "quantity",
        updatedAt: `${todayKey}T10:00:00.000Z`,
      },
    ],
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    estimatedProfitUgx: profitUgx,
    pendingSync: false,
    lastSyncError: null,
  };
}

describe("computePharmacyDashboardStats", () => {
  it("today profit matches getCompletedFinancials for the same day", () => {
    const products = [product({})];
    const sales = [completedSale(1000, 500)];
    const stats = computePharmacyDashboardStats(products, sales, [], todayKey);
    const fin = getCompletedFinancials(sales, [], products, { day: todayKey });
    expect(stats.todayProfitUgx).toBe(fin.profitUgx);
    expect(stats.todayDispensingTotalUgx).toBe(fin.revenueUgx);
  });

  it("inventory value uses cost times stock", () => {
    const products = [product({ stockOnHand: 10, costPricePerUnitUgx: 50 })];
    const stats = computePharmacyDashboardStats(products, [], [], todayKey);
    expect(stats.inventoryValueUgx).toBe(500);
  });
});
