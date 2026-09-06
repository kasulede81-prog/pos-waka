import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CashExpense, DayCloseSummary, Product, Purchase, Sale } from "../types";
import { attributeSalePaymentBuckets } from "./cashPosition";
import { dayClosesForAuthority } from "./closedDayAuthority";
import {
  presentCommandCenterOfficialFinancials,
} from "./commandCenterPageView";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import {
  buildFinancialExtended,
  paymentMixFromRevenueSales,
  presentCommandCenterPeriodFinancialIntelligence,
} from "./ownerCommandCenterBuilders";
import { isPurchaseVoided } from "./purchaseCorrections";
import { resolveReportsFinancialReadiness } from "./reportsDataCompleteness";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const OPEN_DAY = "2026-08-13";
const CLOSED_DAY = "2026-08-12";
const ARCHIVED_DAY = "2026-04-10";

const product: Product = {
  id: "p1",
  name: "Item",
  sellingPricePerUnitUgx: 100_000,
  costPricePerUnitUgx: 60_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${OPEN_DAY}T09:00:00.000Z`,
  version: 1,
};

function bounds(fromKey: string, toKey = fromKey) {
  return { fromKey, toKey, isSingleDay: fromKey === toKey };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx" | "createdAt">): Sale {
  return {
    status: "completed",
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    paymentMethod: partial.paymentMethod ?? "cash",
    estimatedProfitUgx: partial.estimatedProfitUgx ?? partial.totalUgx - 60_000,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 60_000,
        lineTotalUgx: partial.totalUgx,
        estimatedProfitUgx: partial.totalUgx - 60_000,
        inputMode: "quantity",
        voided: false,
        updatedAt: partial.createdAt,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

function expense(id: string, amountUgx: number, paidOn: string): CashExpense {
  return {
    id,
    category: "ops",
    amountUgx,
    description: "Expense",
    paidOn,
    createdAt: `${paidOn}T12:00:00.000Z`,
    createdByUserId: "owner",
    pendingSync: false,
    approvalStatus: "approved",
  };
}

function purchaseRow(id: string, totalCostUgx: number, createdAt: string, voidedAt?: string): Purchase {
  return {
    id,
    supplierId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    supplierName: "Mukwano",
    createdAt,
    totalCostUgx,
    amountPaidUgx: totalCostUgx,
    balanceDeltaUgx: 0,
    notes: "",
    pendingSync: false,
    lines: [{ productId: "p1", name: "Item", qtyBuyingUnits: 1, costPerBuyingUnitUgx: totalCostUgx }],
    voidedAt,
  };
}

function closeFor(params: {
  id: string;
  dateKey: string;
  salesUgx: number;
  profitUgx: number;
  debtUgx?: number;
  expenseUgx?: number | null;
  includeSnapshot?: boolean;
}): DayCloseSummary {
  const row = {
    id: params.id,
    dateKey: params.dateKey,
    expectedCashUgx: params.salesUgx,
    countedCashUgx: params.salesUgx,
    differenceUgx: 0,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: params.debtUgx ?? 0,
    profitEstimateUgx: params.profitUgx,
    openingFloatUgx: 0,
    createdAt: `${params.dateKey}T18:00:00.000Z`,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  const includeSnapshot = params.includeSnapshot !== false && params.expenseUgx !== null;
  return {
    ...row,
    documentSnapshot: includeSnapshot
      ? buildDayCloseSnapshot({
          closedByUserId: "owner",
          closedByLabel: "Owner",
          row,
          drawer: {
            cashFromSalesUgx: params.salesUgx,
            debtCollectedUgx: 0,
            refundsUgx: 0,
            expenseUgx: params.expenseUgx ?? 0,
            openingFloatUgx: 0,
            cashSalesUgx: params.salesUgx,
            supplierPaymentsUgx: 0,
            adjustmentInflowsUgx: 0,
            adjustmentOutflowsUgx: 0,
            cashRefundsUgx: 0,
          },
          transactionCount: 1,
        })
      : null,
    supersededAt: null,
    pendingSync: false,
    updatedAt: `${params.dateKey}T18:00:00.000Z`,
  };
}

function financials(input: {
  fromKey: string;
  toKey?: string;
  sales: Sale[];
  dayCloses?: DayCloseSummary[];
  cashExpenses?: CashExpense[];
  purchases?: Purchase[];
}) {
  const periodBounds = bounds(input.fromKey, input.toKey ?? input.fromKey);
  return buildFinancialExtended({
    sales: input.sales,
    returnRecords: [],
    products: [product],
    customers: [],
    suppliers: [],
    purchases: input.purchases ?? [],
    debtPayments: [],
    cashExpenses: input.cashExpenses ?? [],
    bounds: periodBounds,
    dayCloses: input.dayCloses,
    currentPeriod: {
      revenueUgx: 500_000,
      profitUgx: 200_000,
      transactionCount: 3,
      costIncomplete: false,
    },
  });
}

describe("CC-P2-02 Command Center Financial Intelligence authority", () => {
  it("TEST 1 — open day keeps live payment mix, expenses, debt issued, and purchases", () => {
    const cash = sale({
      id: "cash",
      totalUgx: 300_000,
      cashPaidUgx: 300_000,
      paymentMethod: "cash",
      createdAt: `${OPEN_DAY}T10:00:00.000Z`,
    });
    const momo = sale({
      id: "momo",
      totalUgx: 100_000,
      cashPaidUgx: 100_000,
      paymentMethod: "mobile_money",
      createdAt: `${OPEN_DAY}T11:00:00.000Z`,
    });
    const credit = sale({
      id: "credit",
      totalUgx: 100_000,
      cashPaidUgx: 0,
      debtUgx: 100_000,
      paymentMethod: "credit",
      createdAt: `${OPEN_DAY}T12:00:00.000Z`,
    });
    const fin = financials({
      fromKey: OPEN_DAY,
      sales: [cash, momo, credit],
      cashExpenses: [expense("e1", 20_000, OPEN_DAY)],
      purchases: [purchaseRow("buy-1", 40_000, `${OPEN_DAY}T09:00:00.000Z`)],
    });
    expect(fin.revenueUgx).toBe(500_000);
    expect(fin.profitUgx).toBe(200_000);
    expect(fin.paymentMix?.cashUgx).toBe(300_000);
    expect(fin.paymentMix?.mobileMoneyUgx).toBe(100_000);
    expect(fin.paymentMix?.creditUgx).toBe(100_000);
    expect(fin.expensesPeriodUgx).toBe(20_000);
    expect(fin.debtIssuedUgx).toBe(100_000);
    expect(fin.purchasesUgx).toBe(40_000);
  });

  it("TEST 2 — closed day without frozen breakdowns does not use live stand-ins", () => {
    const closed = closeFor({
      id: "closed-no-snap",
      dateKey: CLOSED_DAY,
      salesUgx: 500_000,
      profitUgx: 200_000,
      debtUgx: 80_000,
      expenseUgx: null,
    });
    const liveDifferent = sale({
      id: "live-leftover",
      totalUgx: 90_000,
      cashPaidUgx: 90_000,
      paymentMethod: "cash",
      createdAt: `${CLOSED_DAY}T10:00:00.000Z`,
    });
    const fin = financials({
      fromKey: CLOSED_DAY,
      sales: [liveDifferent],
      dayCloses: [closed],
      cashExpenses: [expense("e-live", 99_000, CLOSED_DAY)],
      purchases: [purchaseRow("buy-live", 75_000, `${CLOSED_DAY}T09:00:00.000Z`)],
    });
    expect(fin.revenueUgx).toBe(500_000);
    expect(fin.profitUgx).toBe(200_000);
    expect(fin.paymentMix).toBeNull();
    expect(fin.expensesPeriodUgx).toBeNull();
    expect(fin.purchasesUgx).toBeNull();
    expect(fin.expensesPeriodUgx).not.toBe(99_000);
    expect(fin.purchasesUgx).not.toBe(75_000);
    expect(fin.paymentMix).not.toEqual(expect.objectContaining({ cashUgx: 90_000 }));
    expect(fin.debtIssuedUgx).toBe(80_000);
    expect(fin.debtIssuedUgx).not.toBe(0);
  });

  it("TEST 3 — closed day uses existing frozen expense and debt-issued fields", () => {
    const closed = closeFor({
      id: "closed-frozen",
      dateKey: CLOSED_DAY,
      salesUgx: 500_000,
      profitUgx: 200_000,
      debtUgx: 50_000,
      expenseUgx: 12_000,
    });
    const fin = financials({
      fromKey: CLOSED_DAY,
      sales: [
        sale({
          id: "live",
          totalUgx: 20_000,
          createdAt: `${CLOSED_DAY}T10:00:00.000Z`,
        }),
      ],
      dayCloses: [closed],
      cashExpenses: [expense("e-live", 99_000, CLOSED_DAY)],
    });
    expect(fin.expensesPeriodUgx).toBe(12_000);
    expect(fin.expensesPeriodUgx).not.toBe(99_000);
    expect(fin.debtIssuedUgx).toBe(50_000);
    expect(fin.paymentMix).toBeNull();
    expect(fin.purchasesUgx).toBeNull();
  });

  it("TEST 4 — archived close follows the same historical authority", () => {
    const archived = closeFor({
      id: "arch",
      dateKey: ARCHIVED_DAY,
      salesUgx: 500_000,
      profitUgx: 200_000,
      debtUgx: 40_000,
      expenseUgx: 8_000,
    });
    const fin = financials({
      fromKey: ARCHIVED_DAY,
      sales: [
        sale({
          id: "leftover",
          totalUgx: 9_000,
          createdAt: `${ARCHIVED_DAY}T10:00:00.000Z`,
        }),
      ],
      dayCloses: dayClosesForAuthority([], [archived]),
      cashExpenses: [expense("e-live", 70_000, ARCHIVED_DAY)],
    });
    expect(fin.expensesPeriodUgx).toBe(8_000);
    expect(fin.debtIssuedUgx).toBe(40_000);
    expect(fin.paymentMix).toBeNull();
    expect(fin.purchasesUgx).toBeNull();
  });

  it("TEST 5 — active close wins over archived for the same date", () => {
    const active = closeFor({
      id: "active",
      dateKey: CLOSED_DAY,
      salesUgx: 500_000,
      profitUgx: 200_000,
      debtUgx: 50_000,
      expenseUgx: 12_000,
    });
    const archived = closeFor({
      id: "arch",
      dateKey: CLOSED_DAY,
      salesUgx: 100_000,
      profitUgx: 10_000,
      debtUgx: 5_000,
      expenseUgx: 1_000,
    });
    const fin = financials({
      fromKey: CLOSED_DAY,
      sales: [],
      dayCloses: dayClosesForAuthority([active], [archived]),
    });
    expect(fin.expensesPeriodUgx).toBe(12_000);
    expect(fin.debtIssuedUgx).toBe(50_000);
    expect(fin.expensesPeriodUgx).not.toBe(1_000);
    expect(fin.debtIssuedUgx).not.toBe(5_000);
  });

  it("TEST 6 — mixed range does not silently mix incompatible breakdowns", () => {
    const archived = closeFor({
      id: "arch",
      dateKey: ARCHIVED_DAY,
      salesUgx: 500_000,
      profitUgx: 200_000,
      debtUgx: 40_000,
      expenseUgx: 8_000,
    });
    const openSale = sale({
      id: "open",
      totalUgx: 80_000,
      cashPaidUgx: 80_000,
      paymentMethod: "cash",
      createdAt: `${OPEN_DAY}T10:00:00.000Z`,
      debtUgx: 0,
    });
    const fin = financials({
      fromKey: ARCHIVED_DAY,
      toKey: OPEN_DAY,
      sales: [openSale],
      dayCloses: dayClosesForAuthority([], [archived]),
      cashExpenses: [expense("e-open", 5_000, OPEN_DAY)],
      purchases: [purchaseRow("buy-open", 30_000, `${OPEN_DAY}T09:00:00.000Z`)],
    });
    expect(fin.paymentMix).toBeNull();
    expect(fin.purchasesUgx).toBeNull();
    expect(fin.purchasesUgx).not.toBe(30_000);
    expect(fin.expensesPeriodUgx).toBe(8_000 + 5_000);
    expect(fin.debtIssuedUgx).toBe(40_000);
  });

  it("TEST 7 — open mixed tender keeps attributeSalePaymentBuckets (30/20/50)", () => {
    const mixed = sale({
      id: "mix",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: 30_000,
      createdAt: `${OPEN_DAY}T10:00:00.000Z`,
    });
    expect(attributeSalePaymentBuckets(mixed)).toMatchObject({
      cash: 30_000,
      mobile_money: 20_000,
      credit: 50_000,
    });
    const mix = paymentMixFromRevenueSales([mixed]);
    expect(mix.cashUgx).toBe(30_000);
    expect(mix.mobileMoneyUgx).toBe(20_000);
    expect(mix.creditUgx).toBe(50_000);
    const fin = financials({ fromKey: OPEN_DAY, sales: [mixed] });
    expect(fin.paymentMix?.cashUgx).toBe(30_000);
    expect(fin.paymentMix?.mobileMoneyUgx).toBe(20_000);
    expect(fin.paymentMix?.creditUgx).toBe(50_000);
  });

  it("TEST 8 — voided sale is excluded from payment mix and debt issued", () => {
    const voided = sale({
      id: "voided",
      totalUgx: 100_000,
      cashPaidUgx: 0,
      debtUgx: 100_000,
      paymentMethod: "credit",
      createdAt: `${OPEN_DAY}T10:00:00.000Z`,
      saleVoidedAt: `${OPEN_DAY}T11:00:00.000Z`,
    });
    const live = sale({
      id: "ok",
      totalUgx: 40_000,
      cashPaidUgx: 40_000,
      createdAt: `${OPEN_DAY}T12:00:00.000Z`,
    });
    const fin = financials({ fromKey: OPEN_DAY, sales: [voided, live] });
    expect(fin.paymentMix?.creditUgx).toBe(0);
    expect(fin.paymentMix?.cashUgx).toBe(40_000);
    expect(fin.debtIssuedUgx).toBe(0);
    expect(fin.debtIssuedUgx).not.toBe(100_000);
  });

  it("TEST 9 — voided purchase remains excluded via isPurchaseVoided", () => {
    const valid = purchaseRow("ok", 100_000, `${OPEN_DAY}T09:00:00.000Z`);
    const voided = purchaseRow("void", 50_000, `${OPEN_DAY}T10:00:00.000Z`, `${OPEN_DAY}T18:00:00.000Z`);
    expect(isPurchaseVoided(voided)).toBe(true);
    const fin = financials({
      fromKey: OPEN_DAY,
      sales: [],
      purchases: [valid, voided],
    });
    expect(fin.purchasesUgx).toBe(100_000);
    expect(fin.purchasesUgx).not.toBe(150_000);
  });

  it("TEST 10 — incomplete hydration still hides official financial intelligence", () => {
    const readiness = resolveReportsFinancialReadiness({
      hydrationStage: "interactive",
      salesHistoryHydration: { active: true, loaded: 1, total: 5 },
      authority: "live",
    });
    const official = presentCommandCenterOfficialFinancials({
      readiness,
      overlaid: { revenueUgx: 200_000, profitUgx: 80_000, transactionCount: 4, costIncomplete: false },
      frozenHeadlines: null,
    });
    expect(official.presentHeadlinesAsFinal).toBe(false);
    expect(official.headlineSource).toBe("hidden");
    const live = presentCommandCenterPeriodFinancialIntelligence({
      bounds: bounds(OPEN_DAY),
      dayCloses: [],
      livePaymentMix: {
        cashUgx: 200_000,
        mobileMoneyUgx: 0,
        atmUgx: 0,
        creditUgx: 0,
        mixedUgx: 0,
        otherUgx: 0,
      },
      liveExpensesUgx: 10_000,
      liveDebtIssuedUgx: 40_000,
      livePurchasesUgx: 15_000,
      liveExpenseForDay: () => 10_000,
      liveDebtIssuedForDay: () => 40_000,
    });
    const shownMix = official.presentHeadlinesAsFinal ? live.paymentMix : null;
    const shownExpenses = official.presentHeadlinesAsFinal ? live.expensesPeriodUgx : null;
    const shownDebt = official.presentHeadlinesAsFinal ? live.debtIssuedUgx : null;
    const shownPurchases = official.presentHeadlinesAsFinal ? live.purchasesUgx : null;
    expect(shownMix).toBeNull();
    expect(shownExpenses).toBeNull();
    expect(shownDebt).toBeNull();
    expect(shownPurchases).toBeNull();
  });
});

describe("CC-P2-02 source wiring", () => {
  it("reuses existing classifiers and does not add DayClose schema fields", () => {
    const builder = src("src/lib/ownerCommandCenterBuilders.ts");
    expect(builder).toContain("presentCommandCenterPeriodFinancialIntelligence");
    expect(builder).toContain("attributeSalePaymentBuckets");
    expect(builder).toContain("sumPurchasesForReporting");
    expect(builder).toContain("periodSalesBreakdownsUnavailable");
    expect(builder).toContain("resolvePeriodReportAuthority");
    expect(builder).not.toContain("paymentMixUgx");

    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("useDayClosesForAuthority");
    expect(page).toContain("presentCommandCenterOfficialFinancials");
    expect(page).toContain("presentCommandCenterExpectedCash");
    expect(page).toContain("actorHasEffectivePermission");

    const grid = src("src/components/command-center/CommandCenterFinancialGrid.tsx");
    expect(grid).toContain("officialReady ? financial.paymentMix");
    expect(grid).toContain("formatOfficialHeadlineUgx(purchasesUgx)");
  });
});
