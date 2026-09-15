import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, Sale } from "../types";
import { buildAnalyticsReportRows } from "./analyticsReportExport";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { buildDailyReportPdfBlob } from "./dailyReportPdf";
import { dateKeyKampala } from "./datesUg";
import { localGetRangeSummary } from "./localReporting";
import { buildMonthlyBusinessReport } from "./monthlyBusinessReport";
import { t } from "./i18n";
import { buildDailyReportText } from "./reportExport";
import { resolveReportAuthority } from "./closedDayAuthority";
import type { ShopReportBundle } from "../hooks/useShopReporting";

const DAY_A = "2026-08-12";
const DAY_B = "2026-08-13";

const product: Product = {
  id: "p1",
  name: "Item",
  sellingPricePerUnitUgx: 500_000,
  costPricePerUnitUgx: 100_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${DAY_A}T09:00:00.000Z`,
  version: 1,
};

function sale(id: string, totalUgx: number, createdAt: string): Sale {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: totalUgx - 100_000,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: 100_000,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: totalUgx - 100_000,
        inputMode: "quantity",
        voided: false,
        updatedAt: createdAt,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
  };
}

function closeFor(params: {
  id: string;
  dateKey: string;
  salesUgx: number;
  expectedCashUgx: number;
  countedCashUgx: number;
  profitUgx: number;
  txn: number;
  createdAt: string;
}): DayCloseSummary {
  const differenceUgx = params.countedCashUgx - params.expectedCashUgx;
  const row = {
    id: params.id,
    dateKey: params.dateKey,
    expectedCashUgx: params.expectedCashUgx,
    countedCashUgx: params.countedCashUgx,
    differenceUgx,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: params.profitUgx,
    openingFloatUgx: 0,
    createdAt: params.createdAt,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  const documentSnapshot = buildDayCloseSnapshot({
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
    transactionCount: params.txn,
  });
  return {
    ...row,
    documentSnapshot,
    supersededAt: null,
    pendingSync: false,
    updatedAt: params.createdAt,
  };
}

function bundleFromRange(range: ReturnType<typeof localGetRangeSummary>): ShopReportBundle {
  const summary = range.summary;
  return {
    source: "local",
    authority: range.authority,
    revenue: summary.totalRevenueUgx,
    cash: summary.cashCollectedUgx,
    profit: range.profitUgx,
    debt: "debtIssuedUgx" in summary ? summary.debtIssuedUgx : 0,
    count: summary.transactionCount,
    discountsUgx: "discountsUgx" in summary ? summary.discountsUgx : 0,
    taxesUgx: 0,
    debtOutstanding: range.customers.totalDebtOutstandingUgx,
    topProducts: range.topProducts,
    slowProducts: range.slowProducts,
    marginLeaders: range.topProducts.filter((p) => p.profitUgx > 0).slice(0, 8),
    dailyTrend: [],
    stockValueAtCost: range.inventory.stockValueAtCostUgx,
    supplierDebtTotal: range.supplierDebtTotal,
    loading: false,
  };
}

describe("REPORTS-1.1 closed-day authority", () => {
  const closedSale = sale("s-a", 500_000, `${DAY_A}T10:00:00.000Z`);
  const lateSale = sale("s-late", 30_000, `${DAY_A}T16:00:00.000Z`);
  const close = closeFor({
    id: "close-a",
    dateKey: DAY_A,
    salesUgx: 500_000,
    expectedCashUgx: 500_000,
    countedCashUgx: 490_000,
    profitUgx: 400_000,
    txn: 1,
    createdAt: `${DAY_A}T18:00:00.000Z`,
  });

  it("CASE A: closed Day A stays 500,000 on screen, print, and CSV after a late sale", () => {
    const sales = [closedSale, lateSale];
    const auth = resolveReportAuthority([close], DAY_A);
    expect(auth.closed).toBe(true);
    expect(auth.liveTotalsAllowed).toBe(false);
    expect(auth.frozenTotals?.totalSalesUgx).toBe(500_000);

    const range = localGetRangeSummary(
      sales,
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      [close],
    );
    expect(range.summary.totalRevenueUgx).toBe(500_000);
    expect(range.summary.transactionCount).toBe(1);
    expect(range.profitUgx).toBe(400_000);
    expect(range.authority).toBe("closed_snapshot");

    const print = buildDailyReportText("en", DAY_A, {
      sales,
      products: [product],
      returnRecords: [],
      dayCloses: [close],
    });
    expect(print).toContain("500,000");
    expect(print).not.toContain("530,000");
    expect(print).toContain(t("en", "dailyReportClosedAuthorityNote"));

    const csv = buildAnalyticsReportRows({
      lang: "en",
      title: "Reports",
      periodLabel: DAY_A,
      report: bundleFromRange(range),
      expensesUgx: 0,
      purchasesInPeriodUgx: 0,
      canProfit: true,
    });
    expect(csv.some((row) => row[0] === t("en", "receiptsRangeRevenue") && row[1] === 500_000)).toBe(true);
    expect(csv.some((row) => row[0] === t("en", "salesCount") && row[1] === 1)).toBe(true);
    expect(csv.flat().join(" ")).toContain(t("en", "dailyReportClosedAuthorityNote"));
    expect(csv.flat().join(" ")).toContain(t("en", "dailyReportOperationalDetails"));
  });

  it("CASE B: open days stay live", () => {
    const openSale = sale("s-open", 80_000, `${DAY_B}T10:00:00.000Z`);
    const range = localGetRangeSummary(
      [openSale],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_B },
      [],
      [close],
    );
    expect(range.summary.totalRevenueUgx).toBe(80_000);
    expect(range.authority).toBe("live");
    expect(resolveReportAuthority([close], DAY_B).closed).toBe(false);

    const print = buildDailyReportText("en", DAY_B, {
      sales: [openSale],
      products: [product],
      returnRecords: [],
      dayCloses: [close],
    });
    expect(print).toContain("80,000");
    expect(print).not.toContain(t("en", "dailyReportClosedAuthorityNote"));
  });

  it("CASE C: range freezes Day A and keeps Day B live", () => {
    const dayBSale = sale("s-b", 80_000, `${DAY_B}T10:00:00.000Z`);
    const sales = [closedSale, lateSale, dayBSale];
    const range = localGetRangeSummary(
      sales,
      [product],
      [],
      [],
      [],
      { kind: "range", fromKey: DAY_A, toKey: DAY_B },
      [],
      [close],
    );
    expect(range.summary.totalRevenueUgx).toBe(580_000);
    expect(range.authority).toBe("mixed");

    const monthly = buildMonthlyBusinessReport({
      monthKey: "2026-08",
      shopName: "Waka",
      sales,
      returnRecords: [],
      products: [product],
      staffAccounts: [],
      dayCloses: [close],
    });
    expect(monthly.totalSalesUgx).toBe(580_000);
    expect(monthly.hasClosedDays).toBe(true);
  });

  it("CASE D: Kampala midnight stays on the correct business date", () => {
    expect(dateKeyKampala("2026-08-12T20:59:00.000Z")).toBe("2026-08-12");
    expect(dateKeyKampala("2026-08-12T21:00:00.000Z")).toBe("2026-08-13");
    expect(dateKeyKampala("2026-08-12T21:01:00.000Z")).toBe("2026-08-13");

    const before = sale("s-2359", 500_000, "2026-08-12T20:59:00.000Z");
    const midnight = sale("s-0000", 30_000, "2026-08-12T21:00:00.000Z");
    const after = sale("s-0001", 10_000, "2026-08-12T21:01:00.000Z");
    const rangeA = localGetRangeSummary(
      [before, midnight, after],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: "2026-08-12" },
      [],
      [close],
    );
    expect(rangeA.summary.totalRevenueUgx).toBe(500_000);
    const rangeB = localGetRangeSummary(
      [before, midnight, after],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: "2026-08-13" },
      [],
      [close],
    );
    expect(rangeB.summary.totalRevenueUgx).toBe(40_000);
  });

  it("CASE E: live payment mix is labeled, not presented as the closed ledger", async () => {
    const sales = [closedSale, lateSale];
    const blob = buildDailyReportPdfBlob({
      lang: "en",
      dateKey: DAY_A,
      shopName: "Waka",
      sales,
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [{ productId: "p1", name: "Item", quantity: 2, revenueUgx: 530_000, profitUgx: 330_000 }],
      dayCloses: [close],
    });
    expect(blob.size).toBeGreaterThan(500);
    const pdf = await blob.text();
    expect(pdf).toContain("Closed-day ledger");
    expect(pdf).toContain("Operational details");
    expect(pdf).toContain("UGX 500,000");
    expect(pdf).toContain("UGX 530,000");
  });
});
