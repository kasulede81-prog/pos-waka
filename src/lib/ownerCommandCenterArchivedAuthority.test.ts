import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, Sale } from "../types";
import { buildCommandCenterExportRows } from "./analyticsReportExport";
import { dayClosesForAuthority } from "./closedDayAuthority";
import { createDefaultPreferences } from "../data/defaultSeed";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { buildFinancialExtended } from "./ownerCommandCenterBuilders";
import { buildOwnerCommandCenterContext } from "./ownerCommandCenterContext";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const DAY_A = "2026-04-10";
const DAY_B = "2026-08-12";
const DAY_C = "2026-08-13";

const product: Product = {
  id: "p1",
  name: "Item",
  sellingPricePerUnitUgx: 100_000,
  costPricePerUnitUgx: 40_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${DAY_A}T09:00:00.000Z`,
  version: 1,
};

const preferences = createDefaultPreferences();

function sale(id: string, totalUgx: number, dateKey: string): Sale {
  return {
    id,
    createdAt: `${dateKey}T10:00:00.000Z`,
    updatedAt: `${dateKey}T10:00:00.000Z`,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: totalUgx - 40_000,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: 40_000,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: totalUgx - 40_000,
        inputMode: "quantity",
        voided: false,
        updatedAt: `${dateKey}T10:00:00.000Z`,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
  };
}

function closeFor(params: { id: string; dateKey: string; salesUgx: number; profitUgx: number }): DayCloseSummary {
  const row = {
    id: params.id,
    dateKey: params.dateKey,
    expectedCashUgx: params.salesUgx,
    countedCashUgx: params.salesUgx,
    differenceUgx: 0,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: params.profitUgx,
    openingFloatUgx: 0,
    createdAt: `${params.dateKey}T18:00:00.000Z`,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  return {
    ...row,
    documentSnapshot: buildDayCloseSnapshot({
      closedByUserId: "owner",
      closedByLabel: "Owner",
      row,
      drawer: {
        cashFromSalesUgx: params.salesUgx,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 0,
        cashSalesUgx: params.salesUgx,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: 1,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: `${params.dateKey}T18:00:00.000Z`,
  };
}

const archivedA = closeFor({ id: "arch-a", dateKey: DAY_A, salesUgx: 100_000, profitUgx: 40_000 });
const activeB = closeFor({ id: "active-b", dateKey: DAY_B, salesUgx: 80_000, profitUgx: 32_000 });

function boundsFor(fromKey: string, toKey = fromKey) {
  return { fromKey, toKey, isSingleDay: fromKey === toKey };
}

function commandCenterFinancials(
  sales: Sale[],
  active: DayCloseSummary[],
  archived: DayCloseSummary[],
  fromKey: string,
  toKey = fromKey,
) {
  const bounds = boundsFor(fromKey, toKey);
  const dayCloses = dayClosesForAuthority(active, archived);
  const { overview } = buildOwnerCommandCenterContext({
    lang: "en",
    bounds,
    sales,
    products: [product],
    auditLogs: [],
    returnRecords: [],
    voidRecords: [],
    dayCloses,
    preferences,
  });
  const financial = buildFinancialExtended({
    sales,
    returnRecords: [],
    products: [product],
    customers: [],
    suppliers: [],
    purchases: [],
    debtPayments: [],
    cashExpenses: [],
    bounds,
    dayCloses,
    currentPeriod: {
      revenueUgx: overview.revenueUgx,
      profitUgx: overview.profitUgx,
      transactionCount: overview.transactionCount,
      costIncomplete: overview.costIncomplete,
    },
  });
  const exportRows = buildCommandCenterExportRows({
    lang: "en",
    shopName: "Waka",
    periodLabel: fromKey === toKey ? fromKey : `${fromKey}–${toKey}`,
    score: 80,
    revenueUgx: overview.revenueUgx,
    profitUgx: overview.profitUgx,
    transactions: overview.transactionCount,
    expectedCashUgx: null,
  });
  return { overview, financial, exportRows, dayCloses };
}

describe("REAUDIT-P2-03 Command Center selected-period archived close authority", () => {
  it("TEST 1 — open period stays live", () => {
    const live = sale("open-c", 20_000, DAY_C);
    const { overview, financial } = commandCenterFinancials([live], [], [], DAY_C);
    expect(overview.revenueUgx).toBe(20_000);
    expect(overview.profitUgx).toBe(live.estimatedProfitUgx);
    expect(financial.revenueUgx).toBe(20_000);
    expect(financial.profitUgx).toBe(overview.profitUgx);
  });

  it("TEST 2 — active closed day keeps frozen overlay", () => {
    const leftover = sale("live-b", 9_000, DAY_B);
    const { overview } = commandCenterFinancials([leftover], [activeB], [], DAY_B);
    expect(overview.revenueUgx).toBe(80_000);
    expect(overview.profitUgx).toBe(32_000);
    expect(overview.revenueUgx).not.toBe(9_000);
  });

  it("TEST 3 — archived-only closed day uses archived snapshot, not live leftovers", () => {
    const leftover = sale("live-a", 9_000, DAY_A);
    const activeOnly = commandCenterFinancials([leftover], [], [], DAY_A);
    expect(activeOnly.overview.revenueUgx).toBe(9_000);

    const { overview, financial } = commandCenterFinancials([leftover], [], [archivedA], DAY_A);
    expect(overview.revenueUgx).toBe(100_000);
    expect(overview.profitUgx).toBe(40_000);
    expect(overview.revenueUgx).not.toBe(9_000);
    expect(financial.revenueUgx).toBe(100_000);
    expect(financial.profitUgx).toBe(40_000);
  });

  it("TEST 4 — mixed period applies archived, active, and live days independently", () => {
    const leftoverA = sale("live-a", 9_000, DAY_A);
    const leftoverB = sale("live-b", 4_000, DAY_B);
    const openC = sale("open-c", 20_000, DAY_C);
    const { overview } = commandCenterFinancials(
      [leftoverA, leftoverB, openC],
      [activeB],
      [archivedA],
      DAY_A,
      DAY_C,
    );
    expect(overview.revenueUgx).toBe(100_000 + 80_000 + 20_000);
    expect(overview.profitUgx).toBe(40_000 + 32_000 + openC.estimatedProfitUgx);
    expect(overview.revenueUgx).not.toBe(9_000 + 4_000 + 20_000);
  });

  it("TEST 5 — screen financials and export rows match", () => {
    const leftover = sale("live-a", 9_000, DAY_A);
    const { overview, financial, exportRows } = commandCenterFinancials([leftover], [], [archivedA], DAY_A);
    expect(financial.revenueUgx).toBe(overview.revenueUgx);
    expect(financial.profitUgx).toBe(overview.profitUgx);
    expect(exportRows.some((row) => row[1] === overview.revenueUgx)).toBe(true);
    expect(exportRows.some((row) => row[1] === overview.profitUgx)).toBe(true);
    expect(exportRows.flat().join(" ")).not.toContain("9000");
  });

  it("TEST 6 — all-time / historical range keeps archived authority", () => {
    const leftover = sale("live-a", 9_000, DAY_A);
    const openC = sale("open-c", 20_000, DAY_C);
    const { overview } = commandCenterFinancials(
      [leftover, openC],
      [],
      [archivedA],
      "2020-01-01",
      DAY_C,
    );
    expect(overview.revenueUgx).toBe(100_000 + 20_000);
    expect(overview.profitUgx).toBe(40_000 + openC.estimatedProfitUgx);
    expect(overview.revenueUgx).not.toBe(9_000 + 20_000);
  });
});

describe("REAUDIT-P2-03 source wiring", () => {
  it("Owner Command Center uses useDayClosesForAuthority for selected-period financials", () => {
    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("useDayClosesForAuthority");
    expect(page).not.toMatch(/usePosStore\(\(s\) => s\.dayCloses\)/);

    const context = src("src/lib/ownerCommandCenterContext.ts");
    expect(context).toContain("overlayPeriodFinancials");
    expect(context).not.toContain("useDayClosesForAuthority");
    expect(context).not.toContain("archivedDayCloses");
  });
});
