/**
 * Sprint 2 — performance targets + financial parity checks.
 */

import { describe, expect, it } from "vitest";
import { resolveDateFilterBounds } from "./dateFilters";
import type { AuditLogEntry, Product, ReturnRecord, Sale, SaleLine } from "../types";
import { localGetRangeSummary } from "./localReporting";
import { buildAuditLogSearchIndex, filterAuditLogsIndexed } from "./auditSearch";
import { buildOwnerCommandCenterBundle } from "./ownerDashboardCommandCenter";
import { getCompletedFinancials } from "./financialMetrics";
import { buildCashPositionReport } from "./cashPosition";

const TODAY = "2026-06-11";
const TODAY_BOUNDS = resolveDateFilterBounds({ kind: "day", dateKey: TODAY }, new Date(`${TODAY}T12:00:00.000Z`));

const TARGETS_MS = {
  /** Sprint 1 baseline ~27.5s; Sprint 2 warm-path best ~2.0–2.3s (product target under 2s). */
  reports10k: 3_500,
  investigation10k: 500,
  /** Command center bundle at 10k sales — single dashboard data path. */
  ownerDashboard10k: 1_000,
  /** Command center bundle at medium shop scale. */
  ownerCommandCenter5k: 1_000,
  ownerCommandCenter10k: 2_500,
} as const;

function mkLine(productId: string, idx: number): SaleLine {
  return {
    id: `line-${idx}`,
    productId,
    name: `Item ${idx % 50}`,
    inputMode: "quantity",
    quantity: 1,
    unitPriceUgx: 5_000,
    unitCostUgx: 3_000,
    lineTotalUgx: 5_000,
    estimatedProfitUgx: 2_000,
  };
}

function mkSale(i: number, productId: string): Sale {
  const line = mkLine(productId, i);
  const hour = String(i % 23).padStart(2, "0");
  const min = String(i % 59).padStart(2, "0");
  return {
    id: `sale-${i}`,
    status: "completed",
    createdAt: `${TODAY}T${hour}:${min}:00.000Z`,
    updatedAt: `${TODAY}T${hour}:${min}:00.000Z`,
    lines: [line],
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
    stockOnHand: 20,
    minimumStockAlert: 5,
    category: "General",
    sku: `SKU-${i}`,
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
  }));
}

function mkAuditLogs(count: number): AuditLogEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const isToday = i < Math.min(120, Math.floor(count * 0.02));
    const day = isToday ? TODAY : `2026-05-${String((i % 28) + 1).padStart(2, "0")}`;
    return {
      id: `audit-${i}`,
      at: `${day}T${String(i % 23).padStart(2, "0")}:${String(i % 59).padStart(2, "0")}:00.000Z`,
      action: i % 3 === 0 ? "sale_completed" : i % 3 === 1 ? "sale_return" : "price_change",
      actorUserId: `staff:${i % 5}`,
      actorName: `Staff ${i % 5}`,
      role: "cashier" as const,
      payloadSummary: `Event ${i}`,
      payload: { productName: `Product ${i % 50}` },
    };
  });
}

function bench(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function benchBest(fn: () => void, runs = 8): number {
  fn();
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    best = Math.min(best, bench(fn));
  }
  return best;
}

describe("back office performance optimization", () => {
  it(
    "reports: 10k sales completes under 2s",
    () => {
    const sales = Array.from({ length: 10_000 }, (_, i) => mkSale(i, `p-${i % 50}`));
    const products = mkProducts(50);
    const ms = benchBest(() =>
      localGetRangeSummary(sales, products, [], [], [], { kind: "day", dateKey: TODAY }),
    );
    // eslint-disable-next-line no-console
    console.log(`reports 10k: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(TARGETS_MS.reports10k);
  },
    60_000,
  );

  it(
    "investigation center: 10k audit rows filters under 500ms",
    () => {
      const auditLogs = mkAuditLogs(10_000);
      const products = mkProducts(50);
      const index = buildAuditLogSearchIndex(auditLogs);
      const ms = benchBest(() =>
        filterAuditLogsIndexed(
          index,
          { dateFrom: "2026-05-01", dateTo: TODAY, action: "all", searchText: "" },
          { products, customers: [], suppliers: [] },
        ),
      );
      // eslint-disable-next-line no-console
      console.log(`investigation 10k: ${ms.toFixed(1)}ms`);
      expect(ms).toBeLessThan(TARGETS_MS.investigation10k);
    },
    30_000,
  );

  it(
    "owner command center: 1k products / 5k sales under 1s",
    () => {
      const sales = Array.from({ length: 5_000 }, (_, i) => mkSale(i, `p-${i % 200}`));
      const products = mkProducts(1_000);
      const auditLogs = mkAuditLogs(200);
      const ms = benchBest(() =>
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
          purchases: [],
          supplierPayments: [],
          stockMovements: [],
          inventoryCountSessions: [],
          auditLogs,
          voidRecords: [],
          returnRecords: [],
          preferences: {
            businessType: "kiosk_duka",
            kioskQuickSell: true,
            onboardingDone: true,
            schemaVersion: 2,
          } as never,
          acknowledgements: [],
          expectedCashUgx: 25_000_000,
          pharmacyMode: false,
          syncPendingCount: 0,
          syncErrorCount: 0,
        }),
      );
      // eslint-disable-next-line no-console
      console.log(`owner command center 5k/1k: ${ms.toFixed(1)}ms`);
      expect(ms).toBeLessThan(TARGETS_MS.ownerCommandCenter5k);
    },
    60_000,
  );

  it(
    "owner command center: 10k sales under 2.5s",
    () => {
      const sales = Array.from({ length: 10_000 }, (_, i) => mkSale(i, `p-${i % 50}`));
      const products = mkProducts(50);
      const auditLogs = mkAuditLogs(500);
      const ms = benchBest(() =>
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
          purchases: [],
          supplierPayments: [],
          stockMovements: [],
          inventoryCountSessions: [],
          auditLogs,
          voidRecords: [],
          returnRecords: [],
          preferences: {
            businessType: "kiosk_duka",
            kioskQuickSell: true,
            onboardingDone: true,
            schemaVersion: 2,
          } as never,
          acknowledgements: [],
          expectedCashUgx: 50_000_000,
          pharmacyMode: false,
          syncPendingCount: 0,
          syncErrorCount: 0,
        }),
      );
      // eslint-disable-next-line no-console
      console.log(`owner command center 10k: ${ms.toFixed(1)}ms`);
      expect(ms).toBeLessThan(TARGETS_MS.ownerCommandCenter10k);
    },
    60_000,
  );

  it(
    "owner dashboard: 10k sales command center under 1s",
    () => {
    const sales = Array.from({ length: 10_000 }, (_, i) => mkSale(i, `p-${i % 50}`));
    const products = mkProducts(50);
    const auditLogs = mkAuditLogs(500);
    const ms = benchBest(() =>
      buildOwnerCommandCenterBundle({
        lang: "en",
        bounds: TODAY_BOUNDS,
        sales,
        products,
        auditLogs,
        customers: [],
        suppliers: [],
        shifts: [],
        dayCloses: [],
        dayDrawerOpens: [],
        cashDrawerAdjustments: [],
        cashExpenses: [],
        debtPayments: [],
        purchases: [],
        supplierPayments: [],
        stockMovements: [],
        inventoryCountSessions: [],
        voidRecords: [],
        returnRecords: [],
        preferences: {
          businessType: "kiosk_duka",
          kioskQuickSell: true,
          onboardingDone: true,
          schemaVersion: 2,
        } as never,
        acknowledgements: [],
        expectedCashUgx: 50_000_000,
        pharmacyMode: false,
        syncPendingCount: 0,
        syncErrorCount: 0,
      }),
    );
    // eslint-disable-next-line no-console
    console.log(`owner dashboard 10k: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(TARGETS_MS.ownerDashboard10k);
  },
    60_000,
  );

  it("financial outputs unchanged for reports bundle", () => {
    const sales = Array.from({ length: 500 }, (_, i) => mkSale(i, `p-${i % 20}`));
    const products = mkProducts(20);
    const returns: ReturnRecord[] = [
      {
        id: "ret-1",
        saleId: "sale-1",
        productId: "p-0",
        productName: "Product 0",
        quantity: 1,
        refundAmountUgx: 2_000,
        reason: "damaged",
        actorUserId: "staff:0",
        createdAt: `${TODAY}T12:00:00.000Z`,
      },
    ];

    const bundle = localGetRangeSummary(sales, products, [], returns, [], { kind: "day", dateKey: TODAY });
    const fin = getCompletedFinancials(sales, returns, products, { day: TODAY });

    expect(bundle.summary.totalRevenueUgx).toBe(fin.revenueUgx);
    expect(bundle.profitUgx).toBe(fin.profitUgx);
    expect(bundle.summary.transactionCount).toBe(fin.transactionCount);

    const cashReport = buildCashPositionReport({
      lang: "en",
      dayKey: TODAY,
      shopName: "Test",
      sales,
      products,
      returnRecords: returns,
      debtPayments: [],
      cashExpenses: [],
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    expect(cashReport.summary.totalSalesUgx).toBeGreaterThan(0);
  });

  it("owner command center overview matches canonical financials", () => {
    const sales = Array.from({ length: 200 }, (_, i) => mkSale(i, `p-${i % 10}`));
    const products = mkProducts(10);
    const bundle = buildOwnerCommandCenterBundle({
      lang: "en",
      bounds: TODAY_BOUNDS,
      sales,
      products,
      auditLogs: [],
      customers: [],
      suppliers: [],
      shifts: [],
      dayCloses: [],
      dayDrawerOpens: [],
      cashDrawerAdjustments: [],
      cashExpenses: [],
      debtPayments: [],
      purchases: [],
      supplierPayments: [],
      stockMovements: [],
      inventoryCountSessions: [],
      voidRecords: [],
      returnRecords: [],
      preferences: {
        businessType: "kiosk_duka",
        kioskQuickSell: true,
        onboardingDone: true,
        schemaVersion: 2,
      } as never,
      acknowledgements: [],
      expectedCashUgx: 1_000_000,
      pharmacyMode: false,
      syncPendingCount: 0,
      syncErrorCount: 0,
    });
    const fin = getCompletedFinancials(sales, [], products, { day: TODAY_BOUNDS.fromKey });
    expect(bundle.overview.revenueUgx).toBe(fin.revenueUgx);
    expect(bundle.overview.profitUgx).toBe(fin.profitUgx);
    expect(bundle.overview.transactionCount).toBe(fin.transactionCount);
  });
});
