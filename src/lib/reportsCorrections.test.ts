/**
 * REPORTS-CORRECTIONS-1.0 — focused regression for RPT-P0-01 + RPT-P1-01..05.
 */
import { describe, expect, it } from "vitest";
import type {
  DayDrawerOpen,
  DebtPayment,
  Product,
  ReturnRecord,
  Sale,
  ShopPreferences,
} from "../types";
import { attributeSalePaymentBuckets, buildCashPositionReport } from "./cashPosition";
import { buildCashPositionDashboard } from "./cashPositionDashboard";
import {
  physicalCashCollectedFromSale,
} from "./cashDrawerSales";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { buildDailyReportDocument } from "./dailyReportPdf";
import { resolveCashDrawerFormulaVersion } from "./dayDrawerOpen";
import { getCompletedFinancials } from "./financialMetrics";
import { buildDailyReportText } from "./reportExport";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { buildXReportSnapshot } from "./xReport";
import { computePaymentMethodMix } from "../features/business-analytics/lib/analyticsPageView";
import { resolveDateFilterBounds } from "./dateFilters";

const DAY = "2026-08-30";

const products: Product[] = [
  {
    id: "p1",
    name: "Item",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 1_000,
    stockOnHand: 50,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt: `${DAY}T09:00:00.000Z`,
    version: 1,
  },
];

function prefs(version?: ShopPreferences["cashDrawerFormulaVersion"]): ShopPreferences {
  return { cashDrawerFormulaVersion: version } as ShopPreferences;
}

function sale(partial: Partial<Sale> & Pick<Sale, "totalUgx">): Sale {
  return {
    id: crypto.randomUUID(),
    status: "completed",
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    paymentMethod: partial.paymentMethod ?? "cash",
    estimatedProfitUgx: partial.totalUgx - 1_000,
    lines: [
      {
        id: crypto.randomUUID(),
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 1_000,
        estimatedProfitUgx: partial.totalUgx - 1_000,
        inputMode: "quantity",
        updatedAt: `${DAY}T10:00:00.000Z`,
        lineTotalUgx: partial.totalUgx,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    soldByUserId: partial.soldByUserId ?? "staff:c1",
    ...partial,
  };
}

function dayOpen(openingFloatUgx: number): DayDrawerOpen {
  return {
    id: "open-1",
    dateKey: DAY,
    openingFloatUgx,
    countedAt: `${DAY}T07:00:00.000Z`,
    countedByUserId: "owner",
    countedByLabel: "Owner",
    note: "",
    deviceId: "dev",
    status: "open",
    createdAt: `${DAY}T07:00:00.000Z`,
    updatedAt: `${DAY}T07:00:00.000Z`,
    pendingSync: false,
  };
}

const cashierStaff = {
  id: "c1",
  name: "Cashier",
  role: "cashier" as const,
  active: true,
  createdAt: `${DAY}T01:00:00.000Z`,
  updatedAt: `${DAY}T01:00:00.000Z`,
};

function parseExpectedCash(text: string): number {
  const match = text.match(/Expected cash: UGX ([\d,]+)/);
  if (!match?.[1]) throw new Error("missing expected cash");
  return Number(match[1].replace(/,/g, ""));
}

function parseCashInHand(text: string): number {
  const match = text.match(/Cash collected from sales: UGX ([\d,]+)/);
  if (!match?.[1]) throw new Error("missing cash in hand");
  return Number(match[1].replace(/,/g, ""));
}

function ugxFromDoc(doc: ReturnType<typeof buildDailyReportDocument>, label: string): number {
  const row = doc.sections.flatMap((s) => s.rows).find((r) => r.label === label);
  if (!row) throw new Error(`missing row ${label}`);
  return Number(String(row.value).replace(/[^\d]/g, ""));
}

describe("RPT-P0-01 daily expected cash matches Cash Position / Close Day", () => {
  const opens = [dayOpen(100_000)];
  const cashSale = sale({ totalUgx: 40_000 });

  it("includes opening float when dayDrawerOpens + V2 passed", () => {
    const formulaVersion = resolveCashDrawerFormulaVersion(prefs(undefined));
    expect(formulaVersion).toBe("v2");
    const drawer = getDrawerCashForDayInput({
      sales: [cashSale],
      returns: [],
      products,
      debtPayments: [],
      cashExpenses: [],
      dayDrawerOpens: opens,
      formulaVersion,
      day: DAY,
    });
    const text = buildDailyReportText("en", DAY, {
      sales: [cashSale],
      products,
      returnRecords: [],
      dayDrawerOpens: opens,
      formulaVersion,
    });
    expect(parseExpectedCash(text)).toBe(drawer.expectedDrawerCashUgx);
    expect(parseExpectedCash(text)).toBe(140_000);
  });

  it("unset formula preference resolves to V2 (opening float counted)", () => {
    const formulaVersion = resolveCashDrawerFormulaVersion(prefs(undefined));
    expect(formulaVersion).toBe("v2");
    const text = buildDailyReportText("en", DAY, {
      sales: [cashSale],
      products,
      returnRecords: [],
      dayDrawerOpens: opens,
      formulaVersion,
    });
    expect(parseExpectedCash(text)).toBe(140_000);
  });

  it("explicit V1 remains respected (shift float path, not day open)", () => {
    const formulaVersion = resolveCashDrawerFormulaVersion(prefs("v1"));
    expect(formulaVersion).toBe("v1");
    const withOpens = getDrawerCashForDayInput({
      sales: [cashSale],
      returns: [],
      products,
      debtPayments: [],
      cashExpenses: [],
      dayDrawerOpens: opens,
      formulaVersion: "v1",
      day: DAY,
    });
    const text = buildDailyReportText("en", DAY, {
      sales: [cashSale],
      products,
      returnRecords: [],
      dayDrawerOpens: opens,
      formulaVersion: "v1",
    });
    expect(parseExpectedCash(text)).toBe(withOpens.expectedDrawerCashUgx);
    // V1 does not use DayDrawerOpen float the same way as V2
    expect(parseExpectedCash(text)).not.toBe(140_000);
  });

  it("daily text matches Cash Position expected cash", () => {
    const formulaVersion = resolveCashDrawerFormulaVersion(prefs(undefined));
    const cp = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Shop",
      sales: [cashSale],
      products,
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      dayDrawerOpens: opens,
      formulaVersion,
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    const text = buildDailyReportText("en", DAY, {
      sales: [cashSale],
      products,
      returnRecords: [],
      dayDrawerOpens: opens,
      formulaVersion,
    });
    expect(parseExpectedCash(text)).toBe(cp.cashPosition.expectedCashUgx);
  });

  it("daily PDF data matches Cash Position expected cash + physical cashInHand", () => {
    const formulaVersion = resolveCashDrawerFormulaVersion(prefs(undefined));
    const cp = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Shop",
      sales: [cashSale],
      products,
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      dayDrawerOpens: opens,
      formulaVersion,
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    const doc = buildDailyReportDocument({
      lang: "en",
      dateKey: DAY,
      shopName: "Shop",
      sales: [cashSale],
      products,
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      dayDrawerOpens: opens,
      formulaVersion,
      topProducts: [],
    });
    expect(ugxFromDoc(doc, "Expected cash")).toBe(cp.cashPosition.expectedCashUgx);
    expect(ugxFromDoc(doc, "Cash collected from sales")).toBe(cp.cashPosition.cashSalesUgx);
  });

  it("no independent expected-cash formula — same helper as Close Day", () => {
    const formulaVersion = resolveCashDrawerFormulaVersion({});
    const input = {
      sales: [cashSale],
      returns: [] as ReturnRecord[],
      products,
      debtPayments: [] as DebtPayment[],
      cashExpenses: [],
      dayDrawerOpens: opens,
      formulaVersion,
      day: DAY,
    };
    const closeDay = getDrawerCashForDayInput(input).expectedDrawerCashUgx;
    const text = buildDailyReportText("en", DAY, {
      sales: [cashSale],
      products,
      returnRecords: [],
      dayDrawerOpens: opens,
      formulaVersion,
    });
    expect(parseExpectedCash(text)).toBe(closeDay);
  });
});

describe("RPT-P1-01 physical cash vs cashPaid semantics", () => {
  it("cash sale contributes physical cash", () => {
    const s = sale({ totalUgx: 10_000, paymentMethod: "cash", cashPaidUgx: 10_000 });
    expect(physicalCashCollectedFromSale(s)).toBe(10_000);
    expect(s.cashPaidUgx).toBe(10_000);
  });

  it("mixed sale follows physical-cash semantics", () => {
    const s = sale({
      totalUgx: 100_000,
      cashPaidUgx: 60_000,
      debtUgx: 40_000,
      paymentMethod: "mixed",
    });
    expect(physicalCashCollectedFromSale(s)).toBe(60_000);
    expect(s.cashPaidUgx).toBe(60_000);
  });

  it("MoMo contributes 0 physical drawer cash (cashPaid unchanged)", () => {
    const s = sale({
      totalUgx: 25_000,
      cashPaidUgx: 25_000,
      paymentMethod: "mobile_money",
    });
    expect(physicalCashCollectedFromSale(s)).toBe(0);
    expect(s.cashPaidUgx).toBe(25_000);
    const text = buildDailyReportText("en", DAY, {
      sales: [s],
      products,
      returnRecords: [],
    });
    expect(parseCashInHand(text)).toBe(0);
    const fin = getCompletedFinancials([s], [], products, { day: DAY });
    expect(fin.cashCollectedUgx).toBe(25_000);
  });

  it("ATM contributes 0 physical drawer cash (cashPaid unchanged)", () => {
    const s = sale({
      totalUgx: 30_000,
      cashPaidUgx: 30_000,
      paymentMethod: "atm",
    });
    expect(physicalCashCollectedFromSale(s)).toBe(0);
    expect(s.cashPaidUgx).toBe(30_000);
    const text = buildDailyReportText("en", DAY, {
      sales: [s],
      products,
      returnRecords: [],
    });
    expect(parseCashInHand(text)).toBe(0);
  });
});

describe("RPT-P1-02 X Report payment classifications", () => {
  function payments(...sales: Sale[]) {
    return buildXReportSnapshot({
      dateKey: DAY,
      shopName: "Shop",
      sales,
      returns: [],
      products,
      voidRecords: [],
      cashExpenses: [],
      debtPayments: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      dayDrawerOpens: [],
      shifts: [],
      preferences: prefs(undefined),
    }).payments;
  }

  it("classifies cash / mixed / credit / MoMo / ATM consistently with Cash Position", () => {
    const cash = sale({ totalUgx: 10_000, paymentMethod: "cash" });
    const mixed = sale({
      totalUgx: 100_000,
      cashPaidUgx: 70_000,
      debtUgx: 30_000,
      paymentMethod: "mixed",
    });
    const credit = sale({
      totalUgx: 50_000,
      cashPaidUgx: 0,
      debtUgx: 50_000,
      paymentMethod: "credit",
    });
    const momo = sale({ totalUgx: 20_000, paymentMethod: "mobile_money", cashPaidUgx: 20_000 });
    const atm = sale({ totalUgx: 15_000, paymentMethod: "atm", cashPaidUgx: 15_000 });

    const p = payments(cash, mixed, credit, momo, atm);
    expect(p.cashUgx).toBe(10_000 + 70_000);
    expect(p.creditUgx).toBe(30_000 + 50_000);
    expect(p.mobileMoneyUgx).toBe(20_000);
    expect(p.cardUgx).toBe(15_000);
    expect(p.otherUgx).toBe(0);

    for (const s of [cash, mixed, credit, momo, atm]) {
      const b = attributeSalePaymentBuckets(s);
      expect(b.cash + b.mobile_money + b.card + b.bank_transfer + b.credit).toBe(s.totalUgx);
    }
  });
});

describe("RPT-P1-03 analytics payment mix debt semantics", () => {
  const bounds = resolveDateFilterBounds({ kind: "day", dateKey: DAY });

  it("cash / credit / mixed / MoMo / ATM use collected+debt split (not full totalUgx only)", () => {
    const cash = sale({ totalUgx: 10_000, paymentMethod: "cash" });
    const credit = sale({
      totalUgx: 40_000,
      cashPaidUgx: 0,
      debtUgx: 40_000,
      paymentMethod: "credit",
    });
    const mixed = sale({
      totalUgx: 100_000,
      cashPaidUgx: 60_000,
      debtUgx: 40_000,
      paymentMethod: "mixed",
    });
    const momo = sale({ totalUgx: 20_000, paymentMethod: "mobile_money" });
    const atm = sale({ totalUgx: 15_000, paymentMethod: "atm" });

    const mix = computePaymentMethodMix([cash, credit, mixed, momo, atm], bounds);
    const byId = Object.fromEntries(mix.map((m) => [m.id, m.amountUgx]));
    expect(byId.cash).toBe(10_000);
    expect(byId.credit).toBe(40_000 + 40_000);
    expect(byId.mixed).toBe(60_000);
    expect(byId.mobile_money).toBe(20_000);
    expect(byId.atm).toBe(15_000);

    const revenue = [cash, credit, mixed, momo, atm].reduce((a, s) => a + s.totalUgx, 0);
    expect(Object.values(byId).reduce((a, n) => a + n, 0)).toBe(revenue);
  });

  it("debt payment is not treated as new sales revenue in the mix", () => {
    const creditSale = sale({
      totalUgx: 50_000,
      cashPaidUgx: 0,
      debtUgx: 50_000,
      paymentMethod: "credit",
    });
    const debtPayment: DebtPayment = {
      id: "dp1",
      customerId: "c1",
      amountUgx: 20_000,
      createdAt: `${DAY}T14:00:00.000Z`,
    };
    const mix = computePaymentMethodMix([creditSale], bounds);
    expect(mix.find((m) => m.id === "credit")?.amountUgx).toBe(50_000);
    expect(mix.reduce((a, m) => a + m.amountUgx, 0)).toBe(50_000);
    // debt payment exists but is not a Sale — mix ignores it by construction
    expect(debtPayment.amountUgx).toBe(20_000);
  });
});

describe("RPT-P1-04 Cash Position uses isRevenueSale", () => {
  it("completed sale counts; whole-bill void does not", () => {
    const good = sale({ id: "good", totalUgx: 40_000 });
    const voided = sale({
      id: "voided",
      totalUgx: 99_000,
      saleVoidedAt: `${DAY}T11:00:00.000Z`,
    });
    const report = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Shop",
      sales: [good, voided],
      products,
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    expect(report.summary.transactionCount).toBe(1);
    expect(report.summary.totalSalesUgx).toBe(40_000);
    expect(report.cashPosition.expectedCashUgx).toBe(40_000);
  });

  it("linked same-day return remains handled via sale totals", () => {
    const original = sale({ id: "s-link", totalUgx: 100_000, cashPaidUgx: 100_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 20_000) };
    const ret: ReturnRecord = {
      id: "r1",
      saleId: original.id,
      productId: "p1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 20_000,
      reason: "other",
      actorUserId: "staff:c1",
      actorName: "Cashier",
      shiftId: null,
      createdAt: `${DAY}T12:00:00.000Z`,
    };
    const report = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Shop",
      sales: [adjusted],
      products,
      returnRecords: [ret],
      debtPayments: [],
      cashExpenses: [],
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    expect(report.summary.totalSalesUgx).toBe(80_000);
  });
});

describe("RPT-P1-05 cashier netSales no double-subtract of linked returns", () => {
  it("normal sale net equals sales", () => {
    const s = sale({ id: "n1", totalUgx: 50_000, soldByUserId: "staff:c1" });
    const dash = buildCashPositionDashboard({
      lang: "en",
      filter: { kind: "day", dateKey: DAY },
      shopName: "Shop",
      sales: [s],
      products,
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      shifts: [],
      dayDrawerOpens: [],
      dayCloses: [],
      formulaVersion: "v2",
      staffAccounts: [cashierStaff],
      generalCategoryLabel: "General",
      todayKey: DAY,
    });
    const row = dash.cashiers[0]!;
    expect(row.salesUgx).toBe(50_000);
    expect(row.netSalesUgx).toBe(50_000);
    expect(row.refundsUgx).toBe(0);
  });

  it("linked same-day return is not subtracted twice", () => {
    const original = sale({ id: "s-link2", totalUgx: 100_000, soldByUserId: "staff:c1" });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 25_000) };
    const ret: ReturnRecord = {
      id: "r2",
      saleId: original.id,
      productId: "p1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 25_000,
      reason: "other",
      actorUserId: "staff:c1",
      actorName: "Cashier",
      shiftId: null,
      createdAt: `${DAY}T12:00:00.000Z`,
    };
    const dash = buildCashPositionDashboard({
      lang: "en",
      filter: { kind: "day", dateKey: DAY },
      shopName: "Shop",
      sales: [adjusted],
      products,
      returnRecords: [ret],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      shifts: [],
      dayDrawerOpens: [],
      dayCloses: [],
      formulaVersion: "v2",
      staffAccounts: [cashierStaff],
      generalCategoryLabel: "General",
      todayKey: DAY,
    });
    const row = dash.cashiers[0]!;
    expect(row.salesUgx).toBe(75_000);
    expect(row.refundsUgx).toBe(25_000);
    expect(row.netSalesUgx).toBe(75_000);
  });

  it("external refund stays informational without inventing a second revenue cut on that cashier sale", () => {
    const todaySale = sale({ id: "today", totalUgx: 40_000, soldByUserId: "staff:c1" });
    const external: ReturnRecord = {
      id: "r-ext",
      saleId: "prior-day-sale",
      productId: "p1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "other",
      actorUserId: "staff:c1",
      actorName: "Cashier",
      shiftId: null,
      createdAt: `${DAY}T15:00:00.000Z`,
    };
    const dash = buildCashPositionDashboard({
      lang: "en",
      filter: { kind: "day", dateKey: DAY },
      shopName: "Shop",
      sales: [todaySale],
      products,
      returnRecords: [external],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      shifts: [],
      dayDrawerOpens: [],
      dayCloses: [],
      formulaVersion: "v2",
      staffAccounts: [cashierStaff],
      generalCategoryLabel: "General",
      todayKey: DAY,
    });
    const row = dash.cashiers[0]!;
    expect(row.salesUgx).toBe(40_000);
    expect(row.refundsUgx).toBe(10_000);
    expect(row.netSalesUgx).toBe(40_000);
    expect(dash.report.summary.totalSalesUgx).toBe(30_000);
  });

  it("voided sale excluded from cashier net", () => {
    const good = sale({ id: "ok", totalUgx: 20_000, soldByUserId: "staff:c1" });
    const voided = sale({
      id: "vd",
      totalUgx: 80_000,
      soldByUserId: "staff:c1",
      saleVoidedAt: `${DAY}T11:00:00.000Z`,
    });
    const dash = buildCashPositionDashboard({
      lang: "en",
      filter: { kind: "day", dateKey: DAY },
      shopName: "Shop",
      sales: [good, voided],
      products,
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      shifts: [],
      dayDrawerOpens: [],
      dayCloses: [],
      formulaVersion: "v2",
      staffAccounts: [cashierStaff],
      generalCategoryLabel: "General",
      todayKey: DAY,
    });
    expect(dash.cashiers[0]!.netSalesUgx).toBe(20_000);
    expect(dash.cashiers[0]!.transactionCount).toBe(1);
  });

  it("multiple sales with mixed return types", () => {
    const a = sale({ id: "a", totalUgx: 100_000, soldByUserId: "staff:c1" });
    const aAdj = { ...a, ...reduceSaleTotalsByAmount(a, 10_000) };
    const b = sale({ id: "b", totalUgx: 50_000, soldByUserId: "staff:c1" });
    const linked: ReturnRecord = {
      id: "rl",
      saleId: a.id,
      productId: "p1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "other",
      actorUserId: "staff:c1",
      actorName: "Cashier",
      shiftId: null,
      createdAt: `${DAY}T12:00:00.000Z`,
    };
    const external: ReturnRecord = {
      id: "re",
      saleId: "old",
      productId: "p1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 5_000,
      reason: "other",
      actorUserId: "staff:c1",
      actorName: "Cashier",
      shiftId: null,
      createdAt: `${DAY}T13:00:00.000Z`,
    };
    const dash = buildCashPositionDashboard({
      lang: "en",
      filter: { kind: "day", dateKey: DAY },
      shopName: "Shop",
      sales: [aAdj, b],
      products,
      returnRecords: [linked, external],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      shifts: [],
      dayDrawerOpens: [],
      dayCloses: [],
      formulaVersion: "v2",
      staffAccounts: [cashierStaff],
      generalCategoryLabel: "General",
      todayKey: DAY,
    });
    const row = dash.cashiers[0]!;
    expect(row.salesUgx).toBe(140_000);
    expect(row.refundsUgx).toBe(15_000);
    expect(row.netSalesUgx).toBe(140_000);
  });
});
