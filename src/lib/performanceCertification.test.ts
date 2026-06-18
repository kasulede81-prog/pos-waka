import { describe, expect, it } from "vitest";
import { mergePendingSales } from "./pendingSaleMerge";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";
import { buildDailyReportText } from "./reportExport";
import { localGetDailySalesSummary } from "./localReporting";
import type { Product, Sale, SaleLine } from "../types";

const THRESHOLDS_MS = {
  dashboardLoad: 600,
  reportGeneration: 800,
  queueDrain: 100,
  mergePerformance: 160,
  inventoryReconcile: 120,
} as const;

function mkLine(productId: string, idx: number): SaleLine {
  return {
    id: crypto.randomUUID(),
    updatedAt: "2026-06-02T08:00:00.000Z",
    productId,
    name: `Item ${idx}`,
    inputMode: "quantity",
    quantity: 1,
    unitPriceUgx: 1_000 + idx,
    unitCostUgx: 600 + idx,
    lineTotalUgx: 1_000 + idx,
    estimatedProfitUgx: 400,
  };
}

function mkSale(i: number, productId: string): Sale {
  const line = mkLine(productId, i);
  return {
    id: `sale-${i}`,
    status: "completed",
    createdAt: `2026-06-02T08:${String(i % 59).padStart(2, "0")}:00.000Z`,
    updatedAt: `2026-06-02T08:${String(i % 59).padStart(2, "0")}:00.000Z`,
    lines: [line],
    subtotalUgx: line.lineTotalUgx,
    totalUgx: line.lineTotalUgx,
    cashPaidUgx: line.lineTotalUgx,
    debtUgx: 0,
    estimatedProfitUgx: line.estimatedProfitUgx,
    pendingSync: false,
  };
}

describe("performance certification", () => {
  it("dashboard load summary stays under threshold", () => {
    const products: Product[] = Array.from({ length: 300 }, (_, i) => ({
      id: `p-${i}`,
      name: `Product ${i}`,
      sellingMode: "unit",
      baseUnit: "ea",
      sellingPricePerUnitUgx: 1_000 + i,
      costPricePerUnitUgx: 700 + i,
      stockOnHand: 10 + (i % 8),
      minimumStockAlert: 3,
      category: "General",
      sku: `SKU-${i}`,
      updatedAt: "2026-06-02T07:00:00.000Z",
      version: 1,
    }));
    const sales = Array.from({ length: 1200 }, (_, i) => mkSale(i, `p-${i % 300}`));
    const started = Date.now();
    const summary = localGetDailySalesSummary(sales, products, [], "2026-06-02");
    const elapsed = Date.now() - started;
    expect(summary.totalRevenueUgx).toBeGreaterThan(0);
    expect(elapsed).toBeLessThanOrEqual(THRESHOLDS_MS.dashboardLoad);
  });

  it("report generation stays under threshold", () => {
    const products: Product[] = Array.from({ length: 120 }, (_, i) => ({
      id: `r-${i}`,
      name: `Report Product ${i}`,
      sellingMode: "unit",
      baseUnit: "ea",
      sellingPricePerUnitUgx: 1_500,
      costPricePerUnitUgx: 900,
      stockOnHand: 30,
      minimumStockAlert: 4,
      category: "General",
      sku: `R-${i}`,
      updatedAt: "2026-06-02T06:00:00.000Z",
      version: 1,
    }));
    const sales = Array.from({ length: 1000 }, (_, i) => mkSale(i, `r-${i % 120}`));
    const started = Date.now();
    const report = buildDailyReportText("en", "2026-06-02", sales, products, [], [], []);
    const elapsed = Date.now() - started;
    expect(report.length).toBeGreaterThan(100);
    expect(elapsed).toBeLessThanOrEqual(THRESHOLDS_MS.reportGeneration);
  });

  it("queue drain simulation stays under threshold", () => {
    const queue = Array.from({ length: 3000 }, (_, i) => ({ id: `q-${i}`, attempts: 0 }));
    const started = Date.now();
    const drained = queue.filter((item) => item.id.startsWith("q-"));
    const elapsed = Date.now() - started;
    expect(drained.length).toBe(3000);
    expect(elapsed).toBeLessThanOrEqual(THRESHOLDS_MS.queueDrain);
  });

  it("pending sale merge stays under threshold", () => {
    const mkPending = (id: string, offset: number): Sale => ({
      id,
      status: "pending",
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: `2026-06-02T08:${String(10 + offset).padStart(2, "0")}:00.000Z`,
      lines: Array.from({ length: 200 }, (_, i) => mkLine(`m-${i % 60}`, i + offset)),
      subtotalUgx: 200_000,
      totalUgx: 200_000,
      cashPaidUgx: 0,
      debtUgx: 0,
      estimatedProfitUgx: 80_000,
      pendingSync: true,
    });
    const started = Date.now();
    const merged = mergePendingSales(mkPending("p-a", 1), mkPending("p-a", 2));
    const elapsed = Date.now() - started;
    expect(merged.lines.length).toBeGreaterThan(200);
    expect(elapsed).toBeLessThanOrEqual(THRESHOLDS_MS.mergePerformance);
  });

  it("inventory reconciliation stays under threshold", () => {
    const products: Product[] = Array.from({ length: 500 }, (_, i) => ({
      id: `inv-${i}`,
      name: `Inv ${i}`,
      sellingMode: "unit",
      baseUnit: "ea",
      sellingPricePerUnitUgx: 2000,
      costPricePerUnitUgx: 1000,
      stockOnHand: 10,
      minimumStockAlert: 2,
      category: "General",
      sku: `INV-${i}`,
      updatedAt: "2026-06-02T07:00:00.000Z",
      version: 1,
    }));
    const movements = Array.from({ length: 500 }, (_, i) => ({
      id: `mv-${i}`,
      at: "2026-06-02T07:30:00.000Z",
      productId: `inv-${i}`,
      productName: `Inv ${i}`,
      deltaBaseUnits: 10,
      kind: "purchase_in" as const,
      summary: "restock",
    }));
    const started = Date.now();
    const result = verifyInventoryIntegrity({ products, movements });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(THRESHOLDS_MS.inventoryReconcile);
  });
});
