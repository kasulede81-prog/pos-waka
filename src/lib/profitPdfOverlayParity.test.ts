import { describe, expect, it } from "vitest";
import { buildProfitExportRows } from "./analyticsReportExport";
import { overlayPeriodFinancials, resolvePeriodReportAuthority } from "./closedDayAuthority";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { t } from "./i18n";
import { resolveProfitHeadlineCostUgx } from "./profitPageView";
import { buildProfitReportDocument } from "./profitReportDocument";
import { ugxLabel } from "./reportDocumentModel";
import type { DayCloseSummary, Product, Sale } from "../types";

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

function sale(id: string, totalUgx: number, createdAt: string, unitCostUgx = 100_000): Sale {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: totalUgx - unitCostUgx,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: totalUgx - unitCostUgx,
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

function closeFor(dateKey: string, salesUgx: number, profitUgx: number): DayCloseSummary {
  const createdAt = `${dateKey}T18:00:00.000Z`;
  const row = {
    id: `close-${dateKey}`,
    dateKey,
    expectedCashUgx: salesUgx,
    countedCashUgx: salesUgx,
    differenceUgx: 0,
    totalSalesUgx: salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: profitUgx,
    openingFloatUgx: 0,
    createdAt,
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
        cashFromSalesUgx: salesUgx,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 0,
        cashSalesUgx: salesUgx,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: 1,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: createdAt,
  };
}

const closedSale = sale("s-a", 500_000, `${DAY_A}T10:00:00.000Z`);
const lateSale = sale("s-late", 50_000, `${DAY_A}T16:00:00.000Z`);
const closedDaySales = [closedSale, lateSale];
const closeA = closeFor(DAY_A, 500_000, 400_000);
const liveRevenue = 550_000;
const liveProfit = 350_000;
const liveCost = 200_000;
const groups = [{ categoryLabel: "General", profitUgx: liveProfit, products: [{ name: "Item", profitUgx: liveProfit }] }];

function pageHeadlines(
  sales: Sale[],
  dayCloses: DayCloseSummary[],
  bounds: { fromKey: string; toKey: string; isSingleDay: boolean },
  live: { revenueUgx: number; profitUgx: number; costUgx: number },
) {
  const overlaid = overlayPeriodFinancials({
    live: {
      revenueUgx: live.revenueUgx,
      profitUgx: live.profitUgx,
      transactionCount: sales.length,
      debtIssuedUgx: 0,
    },
    dayCloses,
    bounds,
    sales,
    returns: [],
    products: [product],
  });
  const closedPeriod = resolvePeriodReportAuthority(dayCloses, bounds) !== "live";
  return {
    revenueUgx: overlaid.revenueUgx,
    profitUgx: overlaid.profitUgx,
    costUgx: resolveProfitHeadlineCostUgx({
      closedPeriod,
      revenueUgx: overlaid.revenueUgx,
      profitUgx: overlaid.profitUgx,
      liveCostUgx: live.costUgx,
    }),
  };
}

function pdfHeadlines(
  sales: Sale[],
  dayCloses: DayCloseSummary[],
  bounds: { fromKey: string; toKey: string; isSingleDay: boolean },
  live: { revenueUgx: number; profitUgx: number; costUgx: number },
) {
  const doc = buildProfitReportDocument({
    lang: "en",
    shopName: "Waka Mart",
    periodLabel: `${bounds.fromKey}–${bounds.toKey}`,
    bounds,
    sales,
    returnRecords: [],
    products: [product],
    dayCloses,
    profitUgx: live.profitUgx,
    revenueUgx: live.revenueUgx,
    costUgx: live.costUgx,
    marginPct: 0,
    groups,
  });
  const rows = doc.sections[0]?.rows ?? [];
  const value = (label: string) => rows.find((r) => r.label === t("en", label))?.value ?? "";
  return {
    doc,
    revenue: value("profitStatRevenue"),
    profit: value("profitStatGrossProfit"),
    cost: value("profitStatCost"),
  };
}

describe("P1-NEW-01 Profit PDF/print overlay parity", () => {
  const closedBounds = { fromKey: DAY_A, toKey: DAY_A, isSingleDay: true };
  const live = { revenueUgx: liveRevenue, profitUgx: liveProfit, costUgx: liveCost };

  it("TEST 1 — closed-day PDF matches page overlay, not a second overlay", () => {
    const page = pageHeadlines(closedDaySales, [closeA], closedBounds, live);
    expect(page.revenueUgx).toBe(500_000);
    expect(page.profitUgx).toBe(400_000);

    const pdf = pdfHeadlines(closedDaySales, [closeA], closedBounds, live);
    expect(pdf.revenue).toBe(ugxLabel(500_000));
    expect(pdf.profit).toBe(ugxLabel(400_000));
    expect(pdf.revenue).not.toBe(ugxLabel(450_000));
    expect(pdf.profit).not.toBe(ugxLabel(450_000));
  });

  it("TEST 2 — closed-day cost uses the same authoritative pair", () => {
    const page = pageHeadlines(closedDaySales, [closeA], closedBounds, live);
    expect(page.costUgx).toBe(100_000);
    const pdf = pdfHeadlines(closedDaySales, [closeA], closedBounds, live);
    expect(pdf.cost).toBe(ugxLabel(100_000));
    expect(pdf.cost).toBe(ugxLabel(page.costUgx));
  });

  it("TEST 3 — open period PDF equals live page totals", () => {
    const openBounds = { fromKey: DAY_B, toKey: DAY_B, isSingleDay: true };
    const openSale = sale("s-b", 80_000, `${DAY_B}T10:00:00.000Z`, 20_000);
    const openLive = { revenueUgx: 80_000, profitUgx: 60_000, costUgx: 20_000 };
    const page = pageHeadlines([openSale], [], openBounds, openLive);
    expect(page.revenueUgx).toBe(80_000);
    expect(page.profitUgx).toBe(60_000);
    expect(page.costUgx).toBe(20_000);
    const pdf = pdfHeadlines([openSale], [], openBounds, openLive);
    expect(pdf.revenue).toBe(ugxLabel(80_000));
    expect(pdf.profit).toBe(ugxLabel(60_000));
    expect(pdf.cost).toBe(ugxLabel(20_000));
  });

  it("TEST 4 — mixed period PDF matches the page headline", () => {
    const mixedBounds = { fromKey: DAY_A, toKey: DAY_B, isSingleDay: false };
    const openSale = sale("s-b", 80_000, `${DAY_B}T10:00:00.000Z`, 20_000);
    const sales = [...closedDaySales, openSale];
    const mixedLive = { revenueUgx: 630_000, profitUgx: 410_000, costUgx: 220_000 };
    const page = pageHeadlines(sales, [closeA], mixedBounds, mixedLive);
    expect(page.revenueUgx).toBe(580_000);
    expect(page.profitUgx).toBe(460_000);
    expect(page.costUgx).toBe(120_000);
    const pdf = pdfHeadlines(sales, [closeA], mixedBounds, mixedLive);
    expect(pdf.revenue).toBe(ugxLabel(page.revenueUgx));
    expect(pdf.profit).toBe(ugxLabel(page.profitUgx));
    expect(pdf.cost).toBe(ugxLabel(page.costUgx));
  });

  it("TEST 5 — closed-day CSV headlines match PDF", () => {
    const page = pageHeadlines(closedDaySales, [closeA], closedBounds, live);
    const csv = buildProfitExportRows({
      lang: "en",
      periodLabel: DAY_A,
      grossProfitUgx: page.profitUgx,
      revenueUgx: page.revenueUgx,
      costUgx: page.costUgx,
      marginPct: 80,
      closedPeriod: true,
      groups,
    });
    const pdf = pdfHeadlines(closedDaySales, [closeA], closedBounds, live);
    expect(csv).toContainEqual([t("en", "profitStatGrossProfit"), 400_000]);
    expect(csv).toContainEqual([t("en", "profitStatRevenue"), 500_000]);
    expect(csv).toContainEqual([t("en", "profitStatCost"), 100_000]);
    expect(pdf.profit).toBe(ugxLabel(400_000));
    expect(pdf.revenue).toBe(ugxLabel(500_000));
    expect(pdf.cost).toBe(ugxLabel(100_000));
  });

  it("TEST 6 — closed-period labeled live product rows remain", () => {
    const pdf = pdfHeadlines(closedDaySales, [closeA], closedBounds, live);
    const liveSection = pdf.doc.sections.find((s) => s.live);
    expect(liveSection).toBeTruthy();
    expect(liveSection?.title).toContain(t("en", "reportDocLiveBreakdown"));
    expect(liveSection?.rows.some((r) => r.label === t("en", "reportDocLiveBreakdownHint"))).toBe(true);
    expect(liveSection?.rows.some((r) => r.label === "General" && r.value === ugxLabel(liveProfit))).toBe(true);
    expect(liveSection?.rows.some((r) => r.label === "  Item" && r.value === ugxLabel(liveProfit))).toBe(true);
  });
});
