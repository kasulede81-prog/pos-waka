import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import type { CashDrawerAdjustment, CashExpense, DayCloseSummary, Product, Sale } from "../types";
import { dayClosesForAuthority } from "./closedDayAuthority";
import { formatOfficialHeadlineUgx } from "./commandCenterPageView";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import type { OwnerCommandCenterInput } from "./ownerCommandCenter";
import { buildCashControlExtended } from "./ownerCommandCenterBuilders";
import { getCachedOwnerCommandCenterBundle } from "./ownerDashboardCommandCenter";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const OPEN_DAY = "2026-08-13";
const CLOSED_DAY = "2026-08-12";
const ARCHIVED_DAY = "2026-04-10";
const MIXED_OPEN = "2026-04-11";

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
  updatedAt: `${OPEN_DAY}T09:00:00.000Z`,
  version: 1,
};

function bounds(fromKey: string, toKey = fromKey) {
  return { fromKey, toKey, isSingleDay: fromKey === toKey };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "createdAt" | "totalUgx">): Sale {
  return {
    updatedAt: partial.createdAt,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: partial.totalUgx - 40_000,
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
        updatedAt: partial.createdAt,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
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

function closeFor(params: {
  id: string;
  dateKey: string;
  salesUgx: number;
  expenseUgx?: number | null;
  expectedCashUgx?: number;
  countedCashUgx?: number;
  differenceUgx?: number;
}): DayCloseSummary {
  const expected = params.expectedCashUgx ?? params.salesUgx;
  const counted = params.countedCashUgx ?? expected;
  const row = {
    id: params.id,
    dateKey: params.dateKey,
    expectedCashUgx: expected,
    countedCashUgx: counted,
    differenceUgx: params.differenceUgx ?? counted - expected,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: Math.round(params.salesUgx * 0.4),
    openingFloatUgx: 0,
    createdAt: `${params.dateKey}T18:00:00.000Z`,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  const includeSnapshot = params.expenseUgx !== null;
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

function adjustment(partial: Pick<CashDrawerAdjustment, "id" | "type" | "amountUgx" | "occurredAt">): CashDrawerAdjustment {
  return {
    actorUserId: "owner",
    actorName: "Owner",
    note: "",
    pendingSync: false,
    createdAt: partial.occurredAt,
    updatedAt: partial.occurredAt,
    ...partial,
  };
}

function input(extras: Partial<OwnerCommandCenterInput> & { fromKey: string; toKey?: string }): OwnerCommandCenterInput {
  const fromKey = extras.fromKey;
  const toKey = extras.toKey ?? extras.fromKey;
  const { fromKey: _fromKey, toKey: _toKey, ...rest } = extras;
  return {
    lang: "en",
    sales: rest.sales ?? [sale({ id: `s-${fromKey}`, createdAt: `${fromKey}T10:00:00.000Z`, totalUgx: 100_000 })],
    products: [product],
    customers: [],
    suppliers: [],
    shifts: [],
    dayCloses: rest.dayCloses ?? [],
    dayDrawerOpens: [],
    cashDrawerAdjustments: rest.cashDrawerAdjustments ?? [],
    cashExpenses: rest.cashExpenses ?? [],
    debtPayments: [],
    stockMovements: [],
    inventoryCountSessions: [],
    auditLogs: [],
    voidRecords: [],
    returnRecords: [],
    purchases: [],
    supplierPayments: [],
    preferences: createDefaultPreferences(),
    acknowledgements: [],
    expectedCashUgx: rest.expectedCashUgx ?? null,
    pharmacyMode: false,
    syncPendingCount: 0,
    syncErrorCount: 0,
    ...rest,
    bounds: bounds(fromKey, toKey),
  };
}

function cashFromBundle(extras: Partial<OwnerCommandCenterInput> & { fromKey: string; toKey?: string }) {
  const bundle = getCachedOwnerCommandCenterBundle(input(extras));
  return { bundle, cash: bundle.cash, financial: bundle.financial };
}

describe("CC-P2-09 Cash-card expense period authority", () => {
  it("TEST 1 — open day with no close keeps live expenses", () => {
    const { cash, financial } = cashFromBundle({
      fromKey: OPEN_DAY,
      cashExpenses: [expense("e-open", 10_000, OPEN_DAY)],
    });
    expect(cash.cashExpensesUgx).toBe(10_000);
    expect(financial.expensesPeriodUgx).toBe(10_000);
    expect(cash.cashExpensesUgx).toBe(financial.expensesPeriodUgx);
  });

  it("TEST 2 / 4 — active closed day uses frozen expense, not live RAM", () => {
    const { cash, financial } = cashFromBundle({
      fromKey: ARCHIVED_DAY,
      dayCloses: [closeFor({ id: "c-active", dateKey: ARCHIVED_DAY, salesUgx: 80_000, expenseUgx: 20_000 })],
      cashExpenses: [expense("e-live", 5_000, ARCHIVED_DAY)],
    });
    expect(cash.cashExpensesUgx).toBe(20_000);
    expect(cash.cashExpensesUgx).not.toBe(5_000);
    expect(cash.cashExpensesUgx).toBe(financial.expensesPeriodUgx);
  });

  it("TEST 3 — archived closed day uses frozen expense, not live RAM", () => {
    const archived = closeFor({ id: "c-arch", dateKey: ARCHIVED_DAY, salesUgx: 90_000, expenseUgx: 30_000 });
    const { cash, financial } = cashFromBundle({
      fromKey: ARCHIVED_DAY,
      dayCloses: dayClosesForAuthority([], [archived]),
      cashExpenses: [expense("e-live-arch", 7_000, ARCHIVED_DAY)],
    });
    expect(cash.cashExpensesUgx).toBe(30_000);
    expect(cash.cashExpensesUgx).not.toBe(7_000);
    expect(cash.cashExpensesUgx).toBe(financial.expensesPeriodUgx);
  });

  it("TEST 5 — mixed closed + open combines frozen closed with live open", () => {
    const closed = closeFor({ id: "c-mix", dateKey: ARCHIVED_DAY, salesUgx: 80_000, expenseUgx: 20_000 });
    const { cash, financial } = cashFromBundle({
      fromKey: ARCHIVED_DAY,
      toKey: MIXED_OPEN,
      sales: [
        sale({ id: "s-closed", createdAt: `${ARCHIVED_DAY}T10:00:00.000Z`, totalUgx: 80_000 }),
        sale({ id: "s-open", createdAt: `${MIXED_OPEN}T10:00:00.000Z`, totalUgx: 20_000 }),
      ],
      dayCloses: [closed],
      cashExpenses: [expense("e-closed-live", 99_000, ARCHIVED_DAY), expense("e-open", 5_000, MIXED_OPEN)],
    });
    expect(cash.cashExpensesUgx).toBe(25_000);
    expect(cash.cashExpensesUgx).not.toBe(104_000);
    expect(cash.cashExpensesUgx).toBe(financial.expensesPeriodUgx);
  });

  it("TEST 6 — mixed period with missing closed expense authority is unavailable", () => {
    const closed = closeFor({ id: "c-miss", dateKey: ARCHIVED_DAY, salesUgx: 80_000, expenseUgx: null });
    const { cash, financial } = cashFromBundle({
      fromKey: ARCHIVED_DAY,
      toKey: MIXED_OPEN,
      sales: [
        sale({ id: "s-miss-c", createdAt: `${ARCHIVED_DAY}T10:00:00.000Z`, totalUgx: 80_000 }),
        sale({ id: "s-miss-o", createdAt: `${MIXED_OPEN}T10:00:00.000Z`, totalUgx: 20_000 }),
      ],
      dayCloses: [closed],
      cashExpenses: [expense("e-open-only", 5_000, MIXED_OPEN)],
    });
    expect(cash.cashExpensesUgx).toBeNull();
    expect(cash.cashExpensesUgx).not.toBe(5_000);
    expect(financial.expensesPeriodUgx).toBeNull();
    expect(formatOfficialHeadlineUgx(cash.cashExpensesUgx)).toBe("—");
  });

  it("TEST 7 — frozen expense 0 is displayed as 0, not unavailable", () => {
    const { cash } = cashFromBundle({
      fromKey: CLOSED_DAY,
      dayCloses: [closeFor({ id: "c-zero", dateKey: CLOSED_DAY, salesUgx: 50_000, expenseUgx: 0 })],
      cashExpenses: [expense("e-live-zero", 4_000, CLOSED_DAY)],
    });
    expect(cash.cashExpensesUgx).toBe(0);
    expect(cash.cashExpensesUgx).not.toBeNull();
    expect(formatOfficialHeadlineUgx(cash.cashExpensesUgx)).not.toBe("—");
  });

  it("TEST 8 — legacy close missing expenseUgx is unavailable, not live fallback", () => {
    const { cash, financial } = cashFromBundle({
      fromKey: CLOSED_DAY,
      dayCloses: [closeFor({ id: "c-legacy", dateKey: CLOSED_DAY, salesUgx: 50_000, expenseUgx: null })],
      cashExpenses: [expense("e-legacy-live", 15_000, CLOSED_DAY)],
    });
    expect(cash.cashExpensesUgx).toBeNull();
    expect(cash.cashExpensesUgx).not.toBe(15_000);
    expect(financial.expensesPeriodUgx).toBeNull();
  });

  it("TEST 9 — multi-day open/live range keeps live expense aggregation", () => {
    const { cash, financial } = cashFromBundle({
      fromKey: "2026-08-13",
      toKey: "2026-08-14",
      sales: [
        sale({ id: "s-o1", createdAt: "2026-08-13T10:00:00.000Z", totalUgx: 10_000 }),
        sale({ id: "s-o2", createdAt: "2026-08-14T10:00:00.000Z", totalUgx: 10_000 }),
      ],
      cashExpenses: [expense("e-d1", 3_000, "2026-08-13"), expense("e-d2", 4_000, "2026-08-14")],
    });
    expect(cash.cashExpensesUgx).toBe(7_000);
    expect(financial.expensesPeriodUgx).toBe(7_000);
    expect(cash.cashExpensesUgx).not.toBeNull();
  });

  it("TEST 10 — other Cash card values stay independent of expense authority", () => {
    const close = closeFor({
      id: "c-other",
      dateKey: ARCHIVED_DAY,
      salesUgx: 80_000,
      expenseUgx: 20_000,
      expectedCashUgx: 70_000,
      countedCashUgx: 68_000,
      differenceUgx: -2_000,
    });
    const { cash } = cashFromBundle({
      fromKey: ARCHIVED_DAY,
      expectedCashUgx: 70_000,
      dayCloses: [close],
      cashExpenses: [expense("e-other-live", 5_000, ARCHIVED_DAY)],
      cashDrawerAdjustments: [
        adjustment({
          id: "adj-out",
          type: "owner_withdrawal",
          amountUgx: 9_000,
          occurredAt: `${ARCHIVED_DAY}T11:00:00.000Z`,
        }),
        adjustment({
          id: "adj-bank",
          type: "bank_deposit",
          amountUgx: 11_000,
          occurredAt: `${ARCHIVED_DAY}T12:00:00.000Z`,
        }),
      ],
    });
    expect(cash.cashExpensesUgx).toBe(20_000);
    expect(cash.periodExpectedCashUgx).toBe(70_000);
    expect(cash.latestCountedCashUgx).toBe(68_000);
    expect(cash.latestDayVarianceUgx).toBe(-2_000);
    expect(cash.ownerWithdrawalsUgx).toBe(9_000);
    expect(cash.bankDepositsUgx).toBe(11_000);
  });

  it("TEST 11 — Cash card expenses match FI whenever FI expenses are available", () => {
    const cases = [
      cashFromBundle({
        fromKey: OPEN_DAY,
        cashExpenses: [expense("e-agree-open", 12_000, OPEN_DAY)],
      }),
      cashFromBundle({
        fromKey: CLOSED_DAY,
        dayCloses: [closeFor({ id: "c-agree", dateKey: CLOSED_DAY, salesUgx: 40_000, expenseUgx: 15_000 })],
        cashExpenses: [expense("e-agree-live", 2_000, CLOSED_DAY)],
      }),
      cashFromBundle({
        fromKey: ARCHIVED_DAY,
        dayCloses: dayClosesForAuthority(
          [],
          [closeFor({ id: "c-agree-arch", dateKey: ARCHIVED_DAY, salesUgx: 40_000, expenseUgx: 18_000 })],
        ),
        cashExpenses: [expense("e-agree-arch-live", 1_000, ARCHIVED_DAY)],
      }),
    ];
    for (const { cash, financial } of cases) {
      expect(financial.expensesPeriodUgx).not.toBeNull();
      expect(cash.cashExpensesUgx).toBe(financial.expensesPeriodUgx);
    }
  });

  it("TEST 12 — buildCashControlExtended consumes the presented value, not a live re-sum", () => {
    const presented = buildCashControlExtended({
      bounds: bounds(ARCHIVED_DAY),
      primaryDayKey: ARCHIVED_DAY,
      dayDrawerOpens: [],
      dayCloses: [closeFor({ id: "c-pass", dateKey: ARCHIVED_DAY, salesUgx: 10_000, expenseUgx: 20_000 })],
      shifts: [],
      cashDrawerAdjustments: [],
      expensesPeriodUgx: 20_000,
      expectedCashUgx: null,
      lang: "en",
    });
    const unavailable = buildCashControlExtended({
      bounds: bounds(ARCHIVED_DAY),
      primaryDayKey: ARCHIVED_DAY,
      dayDrawerOpens: [],
      dayCloses: [closeFor({ id: "c-pass-miss", dateKey: ARCHIVED_DAY, salesUgx: 10_000, expenseUgx: null })],
      shifts: [],
      cashDrawerAdjustments: [],
      expensesPeriodUgx: null,
      expectedCashUgx: null,
      lang: "en",
    });
    expect(presented.cashExpensesUgx).toBe(20_000);
    expect(unavailable.cashExpensesUgx).toBeNull();
  });
});

describe("CC-P2-09 source wiring", () => {
  it("Cash card expenses come from presented FI authority, not live RAM on historical periods", () => {
    const builders = src("src/lib/ownerCommandCenterBuilders.ts");
    const cashFn = builders.slice(
      builders.indexOf("export function buildCashControlExtended"),
      builders.indexOf("export function buildInventoryExtended"),
    );
    expect(cashFn).toContain("const cashExpensesUgx = input.expensesPeriodUgx");
    expect(cashFn).not.toContain("sumCashExpensesInBounds");

    const bundle = src("src/lib/ownerDashboardCommandCenter.ts");
    expect(bundle).toContain("expensesPeriodUgx: financial.expensesPeriodUgx");
    expect(bundle).toContain("buildOwnerCommandCenterFingerprint");
    expect(bundle.indexOf("const financial = buildFinancialExtended")).toBeLessThan(
      bundle.indexOf("cash: buildCashControlExtended"),
    );

    const card = src("src/components/command-center/CommandCenterCashCard.tsx");
    expect(card).toContain("formatOfficialHeadlineUgx(cash.cashExpensesUgx)");
    expect(card).not.toContain("formatShortUgx(cash.cashExpensesUgx)");
    expect(card).toContain("ownerCashSub");

    const fi = src("src/lib/ownerCommandCenterBuilders.ts");
    expect(fi).toContain("export function presentCommandCenterPeriodFinancialIntelligence");

    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("resolveReportsFinancialReadiness");
    expect(page).toContain("resolveProfitVisibility");
    expect(page).toContain("presentCommandCenterExpectedCash");
  });
});
