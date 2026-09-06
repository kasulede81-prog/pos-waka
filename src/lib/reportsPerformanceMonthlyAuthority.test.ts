import { describe, expect, it } from "vitest";
import type { DayCloseDocumentSnapshot, DayCloseSummary, Product, Sale } from "../types";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { t } from "./i18n";
import {
  buildMonthlyBusinessReport,
  buildMonthlyReportDocument,
  buildMonthlyReportHtml,
  formatMonthlyReportPlain,
  monthlyReportCashInHandDisplay,
  monthlyReportDiscountDisplay,
  monthlyReportToCsv,
} from "./monthlyBusinessReport";

const DAY = "2026-08-12";
const MONTH = "2026-08";

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
  updatedAt: `${DAY}T09:00:00.000Z`,
  version: 1,
};

function sale(id: string, totalUgx: number, extras: Partial<Sale> = {}): Sale {
  const createdAt = extras.createdAt ?? `${DAY}T10:00:00.000Z`;
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: extras.cashPaidUgx ?? totalUgx,
    debtUgx: extras.debtUgx ?? 0,
    paymentMethod: extras.paymentMethod ?? "cash",
    estimatedProfitUgx: extras.estimatedProfitUgx ?? totalUgx - 40_000,
    tenderCashUgx: extras.tenderCashUgx,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: 40_000,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: extras.estimatedProfitUgx ?? totalUgx - 40_000,
        inputMode: "quantity",
        voided: false,
        updatedAt: createdAt,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
    ...extras,
  };
}

function closeFor(params: {
  salesUgx: number;
  dateKey?: string;
  cashFromSalesUgx?: number | null;
  omitCashFromSales?: boolean;
}): DayCloseSummary {
  const dateKey = params.dateKey ?? DAY;
  const createdAt = `${dateKey}T18:00:00.000Z`;
  const row = {
    id: `close-${dateKey}`,
    dateKey,
    expectedCashUgx: params.cashFromSalesUgx ?? 80_000,
    countedCashUgx: params.cashFromSalesUgx ?? 75_000,
    differenceUgx: -5_000,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 50_000,
    profitEstimateUgx: 40_000,
    openingFloatUgx: 0,
    createdAt,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  const cashForBuild = params.cashFromSalesUgx ?? 0;
  const documentSnapshot = buildDayCloseSnapshot({
    closedByUserId: "owner",
    closedByLabel: "Owner",
    row,
    drawer: {
      cashFromSalesUgx: cashForBuild,
      debtCollectedUgx: 0,
      refundsUgx: 0,
      expenseUgx: 12_000,
      openingFloatUgx: 0,
      cashSalesUgx: cashForBuild,
      supplierPaymentsUgx: 0,
      adjustmentInflowsUgx: 0,
      adjustmentOutflowsUgx: 0,
      cashRefundsUgx: 0,
    },
    transactionCount: 1,
  });
  let snap: DayCloseDocumentSnapshot | (Omit<DayCloseDocumentSnapshot, "cashFromSalesUgx"> & {
    cashFromSalesUgx?: number | null;
  }) = documentSnapshot;
  if (params.omitCashFromSales) {
    const { cashFromSalesUgx: _dropped, ...rest } = documentSnapshot;
    snap = rest;
  } else if (params.cashFromSalesUgx === null) {
    snap = { ...documentSnapshot, cashFromSalesUgx: null };
  }
  return {
    ...row,
    documentSnapshot: snap as DayCloseDocumentSnapshot,
    supersededAt: null,
    pendingSync: false,
    updatedAt: createdAt,
  };
}

function monthly(params: { sales: Sale[]; dayCloses?: DayCloseSummary[] }) {
  return buildMonthlyBusinessReport({
    monthKey: MONTH,
    shopName: "Waka",
    sales: params.sales,
    returnRecords: [],
    products: [product],
    staffAccounts: [],
    dayCloses: params.dayCloses,
  });
}

function cashPresentations(report: ReturnType<typeof monthly>) {
  const unavailable = t("en", "reportsClosedBreakdownUnavailable");
  const cashRow = buildMonthlyReportDocument("en", report, { includeProfit: false }).sections[0]?.rows.find(
    (row) => row.label === t("en", "cashInHand"),
  );
  return {
    display: monthlyReportCashInHandDisplay("en", report),
    plain: formatMonthlyReportPlain("en", report, { includeProfit: false }),
    csv: monthlyReportToCsv(report, { includeProfit: false }),
    html: buildMonthlyReportHtml("en", report, { includeProfit: false }),
    documentValue: cashRow?.value ?? "",
    unavailable,
  };
}

describe("RPT-P3-12-1 Performance / monthly cash integrity", () => {
  it("shows authoritative cash when the closed-day snapshot saved physical cash", () => {
    const close = closeFor({ salesUgx: 100_000, cashFromSalesUgx: 30_000 });
    const report = monthly({
      sales: [
        sale("mix", 100_000, {
          cashPaidUgx: 50_000,
          debtUgx: 50_000,
          paymentMethod: "mixed",
          tenderCashUgx: 30_000,
        }),
      ],
      dayCloses: [close],
    });
    expect(report.physicalCashUnavailable).toBe(false);
    expect(report.cashUgx).toBe(30_000);
    const shown = cashPresentations(report);
    expect(shown.display).toBe("UGX 30,000");
    expect(shown.documentValue).toBe("UGX 30,000");
    expect(shown.plain).toContain(`${t("en", "cashInHand")}: UGX 30,000`);
    expect(shown.csv).toContain("cash_ugx");
    expect(shown.csv).toContain("30000");
    expect(shown.html).toContain("UGX 30,000");
    expect(shown.plain).not.toContain(`${t("en", "cashInHand")}: ${shown.unavailable}`);
  });

  it("never presents a numeric cash amount when physical cash is unavailable", () => {
    const close = closeFor({ salesUgx: 100_000, omitCashFromSales: true });
    const liveFallback = sale("mix", 100_000, {
      cashPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "mixed",
      tenderCashUgx: 30_000,
    });
    const report = monthly({ sales: [liveFallback], dayCloses: [close] });
    expect(report.physicalCashUnavailable).toBe(true);

    const shown = cashPresentations(report);
    expect(shown.display).toBe(shown.unavailable);
    expect(shown.documentValue).toBe(shown.unavailable);
    expect(shown.plain).toContain(`${t("en", "cashInHand")}: ${shown.unavailable}`);
    expect(shown.csv).toContain(shown.unavailable);
    expect(shown.html).toContain(shown.unavailable);

    expect(shown.display).not.toMatch(/\d/);
    expect(shown.documentValue).not.toMatch(/\d/);
    expect(shown.plain).not.toMatch(new RegExp(`${t("en", "cashInHand")}: UGX`));
    expect(shown.csv).not.toMatch(/"cash_ugx","\d/);
    expect(shown.html).toContain(`<td>${t("en", "cashInHand")}</td><td>${shown.unavailable}</td>`);
    expect(shown.html).not.toContain(`<td>${t("en", "cashInHand")}</td><td>UGX`);
  });

  it("treats a null closed-day cashFromSalesUgx as unavailable, not zero", () => {
    const close = closeFor({ salesUgx: 100_000, cashFromSalesUgx: null });
    const report = monthly({
      sales: [sale("cash", 100_000, { tenderCashUgx: 100_000 })],
      dayCloses: [close],
    });
    expect(report.physicalCashUnavailable).toBe(true);
    expect(monthlyReportCashInHandDisplay("en", report)).toBe(t("en", "reportsClosedBreakdownUnavailable"));
    expect(monthlyReportCashInHandDisplay("en", report)).not.toBe("UGX 0");
    expect(monthlyReportCashInHandDisplay("en", report)).not.toBe("UGX 100,000");
  });
});

describe("P2-NEW-08 monthly closed-period breakdowns", () => {
  const unavailable = t("en", "reportsClosedBreakdownUnavailable");

  it("TEST 6 — open month still exports live products, cashiers, and discounts", () => {
    const report = monthly({
      sales: [sale("open", 80_000, { discountTotalUgx: 5_000, tenderCashUgx: 80_000 })],
    });
    expect(report.closedDayBreakdownUnavailable).toBe(false);
    expect(report.hasClosedDays).toBe(false);
    expect(report.topProducts).toHaveLength(1);
    expect(report.byCashier.length).toBeGreaterThan(0);
    expect(monthlyReportDiscountDisplay("en", report)).toBe("UGX 5,000");
    const csv = monthlyReportToCsv(report, { includeProfit: false });
    expect(csv).toContain("product");
    expect(csv).toContain("cashier");
    expect(csv).toContain("5000");
    expect(csv).not.toContain(unavailable);
    const plain = formatMonthlyReportPlain("en", report, { includeProfit: false });
    expect(plain).toContain("Item");
    expect(plain).toContain("UGX 5,000");
  });

  it("TEST 7 — closed month does not export live top products as historical data", () => {
    const close = closeFor({ salesUgx: 100_000, cashFromSalesUgx: 30_000 });
    const report = monthly({
      sales: [sale("closed", 100_000, { discountTotalUgx: 12_000, tenderCashUgx: 30_000 })],
      dayCloses: [close],
    });
    expect(report.closedDayBreakdownUnavailable).toBe(true);
    expect(report.totalSalesUgx).toBe(100_000);
    expect(report.topProducts).toEqual([]);
    expect(report.byCashier).toEqual([]);

    const csv = monthlyReportToCsv(report, { includeProfit: false });
    expect(csv).not.toMatch(/^"product",/m);
    expect(csv).toContain(`"breakdown","top_products","${unavailable}"`);
    expect(csv).not.toContain("12,000");

    const plain = formatMonthlyReportPlain("en", report, { includeProfit: false });
    expect(plain).toContain(t("en", "monthlyReportTopProducts"));
    expect(plain).toContain(unavailable);
    expect(plain).not.toMatch(/· Item —/);

    const html = buildMonthlyReportHtml("en", report, { includeProfit: false });
    expect(html).toContain(unavailable);
    expect(html).not.toContain("<td>Item</td>");

    const doc = buildMonthlyReportDocument("en", report, { includeProfit: false });
    const productSection = doc.sections.find((s) => s.title === t("en", "monthlyReportTopProducts"));
    expect(productSection?.live).toBeUndefined();
    expect(productSection?.rows[0]?.label).toBe(unavailable);
    expect(productSection?.rows.some((r) => r.value.includes("UGX"))).toBe(false);
  });

  it("TEST 8 — mixed month uses the same unavailable breakdowns", () => {
    const close = closeFor({ salesUgx: 100_000, cashFromSalesUgx: 30_000, dateKey: DAY });
    const report = monthly({
      sales: [
        sale("closed-day", 100_000, { createdAt: `${DAY}T10:00:00.000Z`, tenderCashUgx: 30_000 }),
        sale("open-day", 80_000, { createdAt: "2026-08-13T10:00:00.000Z", tenderCashUgx: 80_000 }),
      ],
      dayCloses: [close],
    });
    expect(report.hasClosedDays).toBe(true);
    expect(report.closedDayBreakdownUnavailable).toBe(true);
    expect(report.topProducts).toEqual([]);
    expect(monthlyReportToCsv(report, { includeProfit: false })).toContain(unavailable);
  });

  it("TEST 9 — closed/mixed month does not emit live discounts as authoritative", () => {
    const close = closeFor({ salesUgx: 100_000, cashFromSalesUgx: 30_000 });
    const report = monthly({
      sales: [sale("disc", 100_000, { discountTotalUgx: 12_000, tenderCashUgx: 30_000 })],
      dayCloses: [close],
    });
    expect(report.discountsUgx).toBe(12_000);
    expect(monthlyReportDiscountDisplay("en", report)).toBe(unavailable);
    expect(monthlyReportDiscountDisplay("en", report)).not.toBe("UGX 0");
    expect(monthlyReportDiscountDisplay("en", report)).not.toBe("UGX 12,000");
    const csv = monthlyReportToCsv(report, { includeProfit: false });
    expect(csv).toContain(`"discounts_ugx","${unavailable}"`);
    expect(csv).not.toMatch(/"discounts_ugx","12/);
    const doc = buildMonthlyReportDocument("en", report, { includeProfit: false });
    const discountRow = doc.sections[0]?.rows.find((row) => row.label === t("en", "monthlyReportDiscounts"));
    expect(discountRow?.value).toBe(unavailable);
  });

  it("TEST 10 — physical cash unavailable remains distinct from breakdown unavailable", () => {
    const close = closeFor({ salesUgx: 100_000, omitCashFromSales: true });
    const report = monthly({
      sales: [sale("cash-miss", 100_000, { tenderCashUgx: 40_000 })],
      dayCloses: [close],
    });
    expect(report.physicalCashUnavailable).toBe(true);
    expect(report.closedDayBreakdownUnavailable).toBe(true);
    expect(monthlyReportCashInHandDisplay("en", report)).toBe(unavailable);
    expect(monthlyReportDiscountDisplay("en", report)).toBe(unavailable);
    expect(monthlyReportToCsv(report, { includeProfit: false })).not.toMatch(/"cash_ugx","\d/);
  });
});

