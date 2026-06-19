/**
 * Android performance sprint — benchmark gates.
 */

import { describe, expect, it } from "vitest";
import type { Product, Sale, SaleLine } from "../types";
import { resolveDateFilterBounds } from "./dateFilters";
import { buildCashManagementSnapshot } from "./cashManagementSnapshot";
import { buildSharedSystemHealthSnapshot } from "./systemHealthSharedDiagnostics";
import { buildOwnerCommandCenterBundle } from "./ownerDashboardCommandCenter";
import { isLowStock } from "./sellingEngine";

const TODAY = "2026-06-11";
const TODAY_BOUNDS = resolveDateFilterBounds({ kind: "day", dateKey: TODAY }, new Date(`${TODAY}T12:00:00.000Z`));

const TARGETS_MS = {
  inventoryFilter1k: 300,
  systemHealthSnapshot: 500,
  cashManagementSnapshot: 300,
  ownerCommandCenter50k: 1_500,
} as const;

function mkLine(idx: number): SaleLine {
  return {
    id: `line-${idx}`,
    productId: `p-${idx % 50}`,
    name: `Item ${idx % 50}`,
    inputMode: "quantity",
    quantity: 1,
    unitPriceUgx: 5_000,
    unitCostUgx: 3_000,
    lineTotalUgx: 5_000,
    estimatedProfitUgx: 2_000,
  };
}

function mkSale(i: number): Sale {
  const hour = String(i % 23).padStart(2, "0");
  return {
    id: `sale-${i}`,
    status: "completed",
    createdAt: `${TODAY}T${hour}:00:00.000Z`,
    updatedAt: `${TODAY}T${hour}:00:00.000Z`,
    lines: [mkLine(i)],
    subtotalUgx: 5_000,
    totalUgx: 5_000,
    cashPaidUgx: 5_000,
    debtUgx: 0,
    estimatedProfitUgx: 2_000,
    pendingSync: false,
    soldByUserId: `staff:${i % 5}`,
  };
}

function mkProducts(count: number): Product[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p-${i}`,
    name: `Product ${i}`,
    sellingMode: "unit" as const,
    baseUnit: "ea",
    sellingPricePerUnitUgx: 5_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: i % 7 === 0 ? 2 : 20,
    minimumStockAlert: 5,
    category: "General",
    sku: `SKU-${i}`,
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
  }));
}

function benchBest(fn: () => void, runs = 6): number {
  fn();
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/** Mirrors StockPage listableProducts hot path (filter + sort, no render). */
function filterStockProducts(products: Product[], query: string): Product[] {
  const q = query.trim().toLowerCase();
  let list = products;
  if (q) {
    list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q));
  }
  return [...list].sort((a, b) => {
    const al = isLowStock(a) ? 0 : 1;
    const bl = isLowStock(b) ? 0 : 1;
    if (al !== bl) return al - bl;
    return a.name.localeCompare(b.name);
  });
}

describe("android performance sprint", () => {
  it("inventory: filter/sort 1k products under 300ms", () => {
    const products = mkProducts(1_000);
    const ms = benchBest(() => filterStockProducts(products, ""));
    // eslint-disable-next-line no-console
    console.log(`inventory filter 1k: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(TARGETS_MS.inventoryFilter1k);
  });

  it("system health: shared snapshot under 500ms at 10k sales", () => {
    const sales = Array.from({ length: 10_000 }, (_, i) => mkSale(i));
    const products = mkProducts(200);
    const ms = benchBest(() =>
      buildSharedSystemHealthSnapshot({
        customers: [],
        sales,
        debtPayments: [],
        products,
        stockMovements: [],
        suppliers: [],
        purchases: [],
        supplierPayments: [],
        archivedSales: [],
        preferences: { businessType: "kiosk_duka", kioskQuickSell: true, onboardingDone: true, schemaVersion: 2 } as never,
      }),
    );
    // eslint-disable-next-line no-console
    console.log(`system health snapshot 10k: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(TARGETS_MS.systemHealthSnapshot);
  });

  it("cash drawer: management snapshot under 300ms", () => {
    const products = mkProducts(50);
    const ms = benchBest(() =>
      buildCashManagementSnapshot({
        lang: "en",
        preferences: { businessType: "kiosk_duka", kioskQuickSell: true, onboardingDone: true, schemaVersion: 2, cashDrawerFormulaVersion: "v2" } as never,
        dayDrawerOpens: [],
        dayCloses: [],
        shifts: [],
        cashDrawerAdjustments: [],
        expectedCashUgx: 1_000_000,
      }),
    );
    void products;
    // eslint-disable-next-line no-console
    console.log(`cash management snapshot: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(TARGETS_MS.cashManagementSnapshot);
  });

  it("owner command center: 50k sales under 1.5s", () => {
    const sales = Array.from({ length: 50_000 }, (_, i) => mkSale(i));
    const products = mkProducts(1_000);
    const ms = benchBest(
      () =>
        buildOwnerCommandCenterBundle({
          lang: "en",
          bounds: TODAY_BOUNDS,
          sales,
          products,
          customers: [],
          suppliers: [],
          shifts: [],
          dayCloses: [],
          dayDrawerOpens: [],
          cashDrawerAdjustments: [],
          cashExpenses: [],
          debtPayments: [],
          stockMovements: [],
          inventoryCountSessions: [],
          auditLogs: [],
          voidRecords: [],
          returnRecords: [],
          preferences: {
            businessType: "kiosk_duka",
            kioskQuickSell: true,
            onboardingDone: true,
            schemaVersion: 2,
          } as never,
          acknowledgements: [],
          expectedCashUgx: 250_000_000,
          pharmacyMode: false,
          syncPendingCount: 0,
          syncErrorCount: 0,
        }),
      4,
    );
    // eslint-disable-next-line no-console
    console.log(`owner command center 50k: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(TARGETS_MS.ownerCommandCenter50k);
  });
});
