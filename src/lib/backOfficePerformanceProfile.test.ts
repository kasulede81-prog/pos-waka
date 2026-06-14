/**
 * Sprint 1 — measure-only performance profile (no optimizations).
 * Simulates Owner Dashboard, Reports, Cash Position, Investigation Center workloads.
 */

import { describe, expect, it } from "vitest";
import type { AuditLogEntry, Product, ReturnRecord, Sale, SaleLine } from "../types";
import { buildCashPositionReport } from "./cashPosition";
import { localGetRangeSummary } from "./localReporting";
import { filterAuditLogs } from "./auditSearch";
import { getCompletedFinancials } from "./financialMetrics";
import { scanTodaySalesHead } from "./salesDayIndex";
import { computeExtendedOwnerAlerts } from "./ownerIntelligence";
import { dateKeyKampala } from "./datesUg";

const SIZES = [100, 1000, 10_000] as const;
const TODAY = "2026-06-11";

type BenchRow = {
  surface: string;
  sales: number;
  ms: number;
};

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
  return Array.from({ length: count }, (_, i) => ({
    id: `audit-${i}`,
    at: `${TODAY}T${String(i % 23).padStart(2, "0")}:${String(i % 59).padStart(2, "0")}:00.000Z`,
    action: i % 3 === 0 ? "sale_completed" : i % 3 === 1 ? "sale_return" : "price_change",
    actorUserId: `staff:${i % 5}`,
    actorName: `Staff ${i % 5}`,
    role: "cashier",
    payloadSummary: `Event ${i}`,
    payload: { productName: `Product ${i % 50}` },
  }));
}

function bench(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function simulateOwnerDashboard(sales: Sale[], products: Product[], auditLogs: AuditLogEntry[], returns: ReturnRecord[]) {
  const todayKey = TODAY;
  const { todaySales } = scanTodaySalesHead(sales, todayKey);
  getCompletedFinancials(sales, returns, products, { day: todayKey });
  getCompletedFinancials(sales, returns, products, { day: "2026-06-10" });
  todaySales.filter((s) => s.debtUgx > 0);
  auditLogs.filter((e) => e.action === "discount_given" && dateKeyKampala(e.at) === todayKey);
  computeExtendedOwnerAlerts({
    products,
    dayCloses: [],
    auditLogs,
    preferences: { businessType: "kiosk_duka", kioskQuickSell: true, onboardingDone: true, schemaVersion: 2 } as never,
    todayDebtUgx: 0,
    sales,
    todayKey,
  });
  for (const sale of todaySales) {
    for (const line of sale.lines) {
      if (line.voided) continue;
      void line.productId;
    }
  }
}

function simulateReports(sales: Sale[], products: Product[], returns: ReturnRecord[]) {
  localGetRangeSummary(sales, products, [], returns, [], { kind: "preset", preset: "today" });
}

function simulateCashPosition(sales: Sale[], products: Product[], returns: ReturnRecord[]) {
  buildCashPositionReport({
    lang: "en",
    dayKey: TODAY,
    shopName: "Test Shop",
    sales,
    products,
    returnRecords: returns,
    debtPayments: [],
    cashExpenses: [],
    staffAccounts: [],
    generalCategoryLabel: "General",
  });
}

function simulateInvestigationCenter(auditLogs: AuditLogEntry[], products: Product[]) {
  filterAuditLogs(
    auditLogs,
    { dateFrom: "2026-05-01", dateTo: TODAY, action: "all", searchText: "" },
    { products, customers: [], suppliers: [] },
  );
}

describe("back office performance profile (measure only)", () => {
  it(
    "profiles key surfaces at 100 / 1000 / 10000 sales",
    () => {
    const rows: BenchRow[] = [];

    for (const n of SIZES) {
      const sales = Array.from({ length: n }, (_, i) => mkSale(i, `p-${i % 50}`));
      const products = mkProducts(50);
      const returns: ReturnRecord[] = [];
      const auditLogs = mkAuditLogs(Math.min(n * 2, 20_000));

      rows.push({
        surface: "Owner Dashboard",
        sales: n,
        ms: bench(() => simulateOwnerDashboard(sales, products, auditLogs, returns)),
      });
      rows.push({
        surface: "Reports (localGetRangeSummary)",
        sales: n,
        ms: bench(() => simulateReports(sales, products, returns)),
      });
      rows.push({
        surface: "Cash Position",
        sales: n,
        ms: bench(() => simulateCashPosition(sales, products, returns)),
      });
      rows.push({
        surface: "Investigation Center",
        sales: n,
        ms: bench(() => simulateInvestigationCenter(auditLogs, products)),
      });
    }

    // eslint-disable-next-line no-console
    console.table(rows);

    const bySurface = new Map<string, BenchRow[]>();
    for (const row of rows) {
      const list = bySurface.get(row.surface) ?? [];
      list.push(row);
      bySurface.set(row.surface, list);
    }

    for (const [, surfaceRows] of bySurface) {
      const at10k = surfaceRows.find((r) => r.sales === 10_000)!;
      expect(at10k.ms).toBeGreaterThanOrEqual(0);
    }
  },
    120_000,
  );
});
