import { describe, expect, it } from "vitest";
import type { DayCloseSummary, DayDrawerOpen, Product, ReturnRecord, Sale } from "../types";
import { applyClosedDayToCashPositionReport } from "./closedDayAuthority";
import { buildCashPositionReport, sumPaymentMethodAmounts } from "./cashPosition";
import { buildCashPositionDashboard } from "./cashPositionDashboard";
import {
  buildCashPositionDocument,
  cashPositionToCsv,
  cashPositionToPlainText,
} from "./cashPositionExport";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";

const DAY = "2026-08-12";
const NEXT = "2026-08-13";

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

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx">): Sale {
  return {
    status: "completed",
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 40_000,
        lineTotalUgx: partial.totalUgx,
        estimatedProfitUgx: partial.totalUgx - 40_000,
        inputMode: "quantity",
        voided: false,
        updatedAt: `${DAY}T10:00:00.000Z`,
      },
    ],
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    paymentMethod: partial.paymentMethod ?? "cash",
    estimatedProfitUgx: partial.totalUgx - 40_000,
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

function mixedSale(id: string): Sale {
  return sale({
    id,
    totalUgx: 100_000,
    cashPaidUgx: 50_000,
    amountPaidUgx: 50_000,
    debtUgx: 50_000,
    paymentMethod: "credit",
    tenderCashUgx: 30_000,
  });
}

function opening(dateKey: string, openingFloatUgx: number): DayDrawerOpen {
  return {
    id: `open-${dateKey}`,
    dateKey,
    openingFloatUgx,
    countedAt: `${dateKey}T07:00:00.000Z`,
    countedByUserId: "owner",
    countedByLabel: "Owner",
    note: "",
    deviceId: "dev",
    status: "open",
    createdAt: `${dateKey}T07:00:00.000Z`,
    updatedAt: `${dateKey}T07:00:00.000Z`,
    pendingSync: false,
  };
}

function closeMixed(params: {
  expectedCashUgx?: number;
  countedCashUgx?: number;
  cashSalesUgx?: number;
}): DayCloseSummary {
  const expectedCashUgx = params.expectedCashUgx ?? 130_000;
  const countedCashUgx = params.countedCashUgx ?? 130_000;
  const cashSalesUgx = params.cashSalesUgx ?? 30_000;
  const row = {
    id: "close-mixed",
    dateKey: DAY,
    expectedCashUgx,
    countedCashUgx,
    differenceUgx: countedCashUgx - expectedCashUgx,
    totalSalesUgx: 100_000,
    totalDebtUgx: 50_000,
    profitEstimateUgx: 60_000,
    openingFloatUgx: 100_000,
    createdAt: `${DAY}T18:00:00.000Z`,
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
        cashFromSalesUgx: cashSalesUgx,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 100_000,
        cashSalesUgx,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: 1,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: `${DAY}T18:00:00.000Z`,
  };
}

function dashboardInput(opts: {
  sales: Sale[];
  dayCloses?: DayCloseSummary[];
  dayDrawerOpens?: DayDrawerOpen[];
  returnRecords?: ReturnRecord[];
  dayKey?: string;
  todayKey?: string;
}) {
  const dayKey = opts.dayKey ?? DAY;
  return {
    lang: "en" as const,
    filter: { kind: "day" as const, dateKey: dayKey },
    shopName: "Waka",
    sales: opts.sales,
    products: [product],
    returnRecords: opts.returnRecords ?? [],
    debtPayments: [],
    cashExpenses: [],
    supplierPayments: [],
    cashDrawerAdjustments: [],
    shifts: [],
    dayDrawerOpens: opts.dayDrawerOpens ?? [opening(dayKey, 100_000)],
    dayCloses: opts.dayCloses ?? [],
    formulaVersion: "v2" as const,
    staffAccounts: [],
    generalCategoryLabel: "General",
    todayKey: opts.todayKey ?? dayKey,
  };
}

describe("CP-CLOSE-MIX-01 + CP-COUNT-01 closed-day authority", () => {
  it("A — open day stays live: 100k opening + 30k cash → expected 130k and live mix", () => {
    const openSale = sale({ id: "s-open", totalUgx: 30_000, paymentMethod: "cash", tenderCashUgx: 30_000 });
    const dash = buildCashPositionDashboard(
      dashboardInput({ sales: [openSale], todayKey: DAY }),
    );
    expect(dash.report.ledgerClosed).toBeFalsy();
    expect(dash.report.closedDayBreakdownUnavailable).toBeFalsy();
    expect(dash.report.cashPosition.openingFloatUgx).toBe(100_000);
    expect(dash.report.cashPosition.cashSalesUgx).toBe(30_000);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(130_000);
    expect(dash.extendedSummary.currentDrawerCashUgx).toBe(130_000);
    expect(sumPaymentMethodAmounts(dash.report.paymentMethods)).toBe(30_000);
    expect(dash.report.paymentMethods.find((r) => r.key === "cash")?.amountUgx).toBe(30_000);
    expect(dash.timeline.length).toBeGreaterThan(0);
    expect(dash.categories.length).toBeGreaterThan(0);
  });

  it("B — closed day uses frozen close authority, not live rebuild", () => {
    const live = mixedSale("s-mix");
    const close = closeMixed({});
    const dash = buildCashPositionDashboard(
      dashboardInput({ sales: [live], dayCloses: [close], todayKey: NEXT }),
    );
    expect(dash.report.ledgerClosed).toBe(true);
    expect(dash.report.closedDayBreakdownUnavailable).toBe(true);
    expect(dash.report.summary.totalSalesUgx).toBe(100_000);
    expect(dash.report.cashPosition.cashSalesUgx).toBe(30_000);
    expect(dash.report.cashPosition.openingFloatUgx).toBe(100_000);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(130_000);
    expect(dash.report.paymentMethods).toEqual([]);
    expect(dash.report.categories).toEqual([]);
    expect(dash.report.cashiers).toEqual([]);
    expect(dash.timeline).toEqual([]);
    expect(dash.extendedSummary.largestSaleUgx).toBe(0);
  });

  it("C — closed day hero expected = drawer-status expected = count expected", () => {
    const close = closeMixed({ countedCashUgx: 128_000 });
    const dash = buildCashPositionDashboard(
      dashboardInput({ sales: [mixedSale("s-mix")], dayCloses: [close], todayKey: NEXT }),
    );
    const hero = dash.extendedSummary.currentDrawerCashUgx;
    const drawer = dash.drawerStatus?.expectedCashUgx;
    const count = dash.report.cashPosition.expectedCashUgx;
    expect(hero).toBe(130_000);
    expect(drawer).toBe(130_000);
    expect(count).toBe(130_000);
    expect(hero).toBe(drawer);
    expect(drawer).toBe(count);
    expect(dash.drawerStatus?.countedCashUgx).toBe(128_000);
  });

  it("D — post-close live mutation cannot rewrite frozen headlines or resurrect live mix", () => {
    const close = closeMixed({});
    const mutated = sale({
      id: "s-mix",
      totalUgx: 70_000,
      cashPaidUgx: 20_000,
      amountPaidUgx: 20_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: 0,
    });
    const live = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Waka",
      sales: [mutated],
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      dayDrawerOpens: [opening(DAY, 100_000)],
      formulaVersion: "v2",
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    expect(live.summary.totalSalesUgx).toBe(70_000);
    expect(sumPaymentMethodAmounts(live.paymentMethods)).toBe(70_000);

    const dash = buildCashPositionDashboard(
      dashboardInput({ sales: [mutated], dayCloses: [close], todayKey: NEXT }),
    );
    expect(dash.report.summary.totalSalesUgx).toBe(100_000);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(130_000);
    expect(dash.report.cashPosition.cashSalesUgx).toBe(30_000);
    expect(dash.report.paymentMethods).toEqual([]);
    expect(dash.report.closedDayBreakdownUnavailable).toBe(true);
  });

  it("E — closed-day export does not mix frozen totals with live payment lines", () => {
    const close = closeMixed({});
    const mutated = sale({
      id: "s-mix",
      totalUgx: 70_000,
      cashPaidUgx: 20_000,
      debtUgx: 50_000,
      paymentMethod: "mobile_money",
      tenderCashUgx: 0,
    });
    const dash = buildCashPositionDashboard(
      dashboardInput({ sales: [mutated], dayCloses: [close], todayKey: NEXT }),
    );
    const text = cashPositionToPlainText("en", dash.report);
    expect(text).toContain("100,000");
    expect(text).toContain("130,000");
    expect(text).toContain("Unavailable for closed snapshot.");
    expect(text).not.toContain("Grand total");
    expect(text).not.toMatch(/Mobile Money: UGX 70,000/);
    expect(text).not.toMatch(/Cash: UGX 70,000/);

    const csv = cashPositionToCsv(dash.report);
    expect(csv).toContain("total_sales_ugx");
    expect(csv).toContain("100000");
    expect(csv).toContain("expected_cash_ugx");
    expect(csv).toContain("130000");
    expect(csv).toContain("closed_breakdown");
    expect(csv).toContain("unavailable");
    expect(csv).not.toMatch(/"payment"/);

    const doc = buildCashPositionDocument("en", dash.report);
    expect(doc.status).toBe("closed_day");
    expect(doc.sections.some((s) => s.live)).toBe(false);
    expect(doc.sections.some((s) => s.title === "How customers paid")).toBe(false);
    const headline = doc.sections[0]?.rows ?? [];
    expect(headline.some((r) => r.value.includes("100,000"))).toBe(true);
    expect(headline.some((r) => r.value.includes("130,000"))).toBe(true);
  });

  it("F — open-day export remains live", () => {
    const openSale = sale({ id: "s-open", totalUgx: 30_000, paymentMethod: "cash", tenderCashUgx: 30_000 });
    const dash = buildCashPositionDashboard(dashboardInput({ sales: [openSale], todayKey: DAY }));
    const text = cashPositionToPlainText("en", dash.report);
    expect(text).toContain("Grand total");
    expect(text).toContain("30,000");
    expect(text).not.toContain("Unavailable for closed snapshot.");
    const csv = cashPositionToCsv(dash.report);
    expect(csv).toMatch(/"payment","cash"/);
    const doc = buildCashPositionDocument("en", dash.report);
    expect(doc.status).not.toBe("closed_day");
    expect(doc.sections.some((s) => (s.rows ?? []).some((r) => r.label === "Cash"))).toBe(true);
  });

  it("G — later return cannot rewrite closed headlines or invent a second cash formula", () => {
    const original = mixedSale("s-mix");
    const close = closeMixed({});
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 30_000) };
    const ret: ReturnRecord = {
      id: "r1",
      saleId: original.id,
      productId: "p1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 30_000,
      reason: "other",
      actorUserId: "u1",
      createdAt: `${NEXT}T09:00:00.000Z`,
    };
    expect(adjusted.tenderCashUgx).toBe(0);
    const dash = buildCashPositionDashboard(
      dashboardInput({
        sales: [adjusted],
        dayCloses: [close],
        returnRecords: [ret],
        todayKey: NEXT,
      }),
    );
    expect(dash.report.summary.totalSalesUgx).toBe(100_000);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(130_000);
    expect(dash.report.cashPosition.cashSalesUgx).toBe(30_000);
    expect(dash.report.paymentMethods).toEqual([]);
  });

  it("H — archived / missing live sales keep frozen headlines; mix is unavailable, not an empty historical report", () => {
    const close = closeMixed({});
    const dash = buildCashPositionDashboard(
      dashboardInput({ sales: [], dayCloses: [close], todayKey: NEXT }),
    );
    expect(dash.report.summary.totalSalesUgx).toBe(100_000);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(130_000);
    expect(dash.report.closedDayBreakdownUnavailable).toBe(true);
    expect(dash.report.paymentMethods).toEqual([]);
    const text = cashPositionToPlainText("en", dash.report);
    expect(text).toContain("Unavailable for closed snapshot.");
    expect(text).not.toContain("No sales today yet.");
  });

  it("I — retail closed path uses the same frozen authority", () => {
    const retail = sale({ id: "retail", totalUgx: 30_000, paymentMethod: "cash", tenderCashUgx: 30_000 });
    const close = closeMixed({ cashSalesUgx: 30_000 });
    const frozen = applyClosedDayToCashPositionReport(
      buildCashPositionReport({
        lang: "en",
        dayKey: DAY,
        shopName: "Waka",
        sales: [retail],
        products: [product],
        returnRecords: [],
        debtPayments: [],
        cashExpenses: [],
        dayDrawerOpens: [opening(DAY, 100_000)],
        formulaVersion: "v2",
        staffAccounts: [],
        generalCategoryLabel: "General",
      }),
      close,
    );
    expect(frozen.ledgerClosed).toBe(true);
    expect(frozen.cashPosition.expectedCashUgx).toBe(130_000);
    expect(frozen.paymentMethods).toEqual([]);
  });

  it("J — pharmacy closed path uses the same frozen authority", () => {
    const rx = sale({
      id: "rx",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      amountPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: 30_000,
      dispenseType: "prescription",
    });
    const close = closeMixed({});
    const dash = buildCashPositionDashboard(
      dashboardInput({ sales: [rx], dayCloses: [close], todayKey: NEXT }),
    );
    expect(dash.report.ledgerClosed).toBe(true);
    expect(dash.report.summary.totalSalesUgx).toBe(100_000);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(130_000);
    expect(dash.report.paymentMethods).toEqual([]);
  });

  it("K — CASH-NEW-01 open-day mixed tender return is unchanged", () => {
    const original = mixedSale("s-new");
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 30_000) };
    expect(adjusted.tenderCashUgx).toBe(0);
    const ret: ReturnRecord = {
      id: "r-new",
      saleId: original.id,
      productId: "p1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 30_000,
      refundCashUgx: 30_000,
      reason: "other",
      actorUserId: "u1",
      createdAt: `${DAY}T12:00:00.000Z`,
    };
    const dash = buildCashPositionDashboard(
      dashboardInput({
        sales: [adjusted],
        returnRecords: [ret],
        dayDrawerOpens: [opening(DAY, 0)],
        todayKey: DAY,
      }),
    );
    expect(dash.report.ledgerClosed).toBeFalsy();
    expect(dash.report.cashPosition.cashSalesUgx).toBe(0);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(0);
    expect(adjusted.tenderCashUgx).toBe(0);
  });
});
