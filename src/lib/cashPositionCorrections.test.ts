import { describe, expect, it } from "vitest";
import type {
  CashExpense,
  DebtPayment,
  Product,
  ReturnRecord,
  Sale,
  StaffAccount,
} from "../types";
import { buildCashPositionReport } from "./cashPosition";
import {
  buildCashActivityTimeline,
  buildCashPositionDashboard,
  buildCashPositionDashboardFingerprint,
} from "./cashPositionDashboard";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { stampedShopIdForImmediateCashSync } from "../offline/cloudSync";

const DAY = "2026-08-30";
const DAY2 = "2026-08-31";
const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx">): Sale {
  return {
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
        id: "l1",
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
    ...partial,
  };
}

function expense(partial: Partial<CashExpense> & Pick<CashExpense, "id" | "amountUgx">): CashExpense {
  return {
    category: "transport",
    description: "",
    paidOn: DAY,
    createdAt: `${DAY}T12:00:00.000Z`,
    createdByUserId: "owner",
    approvalStatus: "approved",
    pendingSync: false,
    deletedAt: null,
    ...partial,
  };
}

const emptyBounds = {
  fromKey: DAY,
  toKey: DAY,
  isSingleDay: true as const,
};

describe("CASH-POSITION-CORRECTIONS-1.0 P1-01 refund breakdown", () => {
  it("cash (external) refund affects physical expected cash and matches cashRefundsUgx", () => {
    const sales = [sale({ id: "s1", totalUgx: 100_000 })];
    const returns: ReturnRecord[] = [
      {
        id: "r1",
        saleId: null,
        productId: "p1",
        productName: "Item",
        quantity: 1,
        refundAmountUgx: 20_000,
        reason: "other",
        actorUserId: "owner",
        createdAt: `${DAY}T14:00:00.000Z`,
      },
    ];
    const report = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Shop",
      sales,
      products,
      returnRecords: returns,
      debtPayments: [],
      cashExpenses: [],
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    const drawer = getDrawerCashForDayInput({
      sales,
      returns,
      products,
      debtPayments: [],
      cashExpenses: [],
      day: DAY,
    });
    expect(report.cashPosition.cashRefundsUgx).toBe(0);
    expect(report.cashPosition.cashRefundsUgx).toBe(drawer.cashRefundsUgx);
    expect(report.cashPosition.expectedCashUgx).toBe(drawer.expectedDrawerCashUgx);
    expect(report.cashPosition.expectedCashUgx).toBe(100_000);
  });

  it("linked same-day return does not appear as physical drawer cashRefundsUgx", () => {
    const sales = [sale({ id: "s1", totalUgx: 80_000, cashPaidUgx: 80_000 })];
    const returns: ReturnRecord[] = [
      {
        id: "r1",
        saleId: "s1",
        productId: "p1",
        productName: "Item",
        quantity: 1,
        refundAmountUgx: 20_000,
        reason: "other",
        actorUserId: "owner",
        createdAt: `${DAY}T14:00:00.000Z`,
      },
    ];
    const report = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Shop",
      sales,
      products,
      returnRecords: returns,
      debtPayments: [],
      cashExpenses: [],
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    expect(report.cashPosition.refundsUgx).toBe(20_000);
    expect(report.cashPosition.cashRefundsUgx).toBe(0);
    expect(report.cashPosition.expectedCashUgx).toBe(80_000);
  });
});

describe("CASH-POSITION-CORRECTIONS-1.0 P1-02 timeline expenses", () => {
  const baseTimeline = (cashExpenses: CashExpense[]) =>
    buildCashActivityTimeline({
      lang: "en",
      bounds: emptyBounds,
      sales: [],
      returnRecords: [],
      debtPayments: [],
      cashExpenses,
      supplierPayments: [],
      cashDrawerAdjustments: [],
      dayDrawerOpens: [],
    });

  it("approved expense appears in timeline and expected cash", () => {
    const approved = expense({ id: "e-ok", amountUgx: 5_000, approvalStatus: "approved" });
    const events = baseTimeline([approved]);
    expect(events.some((e) => e.id === "exp-e-ok")).toBe(true);
    const report = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Shop",
      sales: [sale({ id: "s1", totalUgx: 50_000 })],
      products,
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [approved],
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    expect(report.cashPosition.expensesUgx).toBe(5_000);
    expect(report.cashPosition.expectedCashUgx).toBe(45_000);
  });

  it("pending expense does not appear as completed activity", () => {
    const pending = expense({ id: "e-pend", amountUgx: 5_000, approvalStatus: "pending" });
    expect(baseTimeline([pending]).some((e) => e.id === "exp-e-pend")).toBe(false);
  });

  it("rejected and deleted expenses do not appear", () => {
    const rejected = expense({ id: "e-rej", amountUgx: 5_000, approvalStatus: "rejected" });
    const deleted = expense({
      id: "e-del",
      amountUgx: 5_000,
      approvalStatus: "approved",
      deletedAt: `${DAY}T15:00:00.000Z`,
    });
    const events = baseTimeline([rejected, deleted]);
    expect(events.some((e) => e.id === "exp-e-rej")).toBe(false);
    expect(events.some((e) => e.id === "exp-e-del")).toBe(false);
  });
});

describe("CASH-POSITION-CORRECTIONS-1.0 P1-03 multi-day expected", () => {
  it("single-day expected cash remains V2", () => {
    const dash = buildCashPositionDashboard({
      lang: "en",
      filter: { kind: "day", dateKey: DAY },
      shopName: "Shop",
      sales: [sale({ id: "s1", totalUgx: 40_000 })],
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
      staffAccounts: [],
      generalCategoryLabel: "General",
      todayKey: DAY,
    });
    expect(dash.isSingleDay).toBe(true);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(40_000);
  });

  it("multi-day range does not claim 0 as expected drawer balance", () => {
    const sales = [
      sale({ id: "s1", totalUgx: 40_000, createdAt: `${DAY}T10:00:00.000Z` }),
      sale({
        id: "s2",
        totalUgx: 30_000,
        createdAt: `${DAY2}T10:00:00.000Z`,
        updatedAt: `${DAY2}T10:00:00.000Z`,
      }),
    ];
    const dash = buildCashPositionDashboard({
      lang: "en",
      filter: { kind: "range", fromKey: DAY, toKey: DAY2 },
      shopName: "Shop",
      sales,
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
      staffAccounts: [],
      generalCategoryLabel: "General",
      todayKey: DAY2,
    });
    expect(dash.isSingleDay).toBe(false);
    expect(dash.report.cashPosition.expectedCashUgx).toBeNull();
    expect(dash.report.cashPosition.cashSalesUgx).toBe(70_000);
    expect(dash.report.summary.totalSalesUgx).toBe(70_000);
  });
});

describe("CASH-POSITION-CORRECTIONS-1.0 P1-04 fingerprint", () => {
  const base = {
    shopId: SHOP_A,
    filter: { kind: "day" as const, dateKey: DAY },
    sales: [sale({ id: "s1", totalUgx: 10_000 })],
    products,
    staffAccounts: [
      {
        id: "st1",
        name: "Ann",
        role: "cashier",
        pinHash: "x",
        active: true,
        createdAt: DAY,
        updatedAt: DAY,
      } satisfies StaffAccount,
    ],
    returnRecords: [] as ReturnRecord[],
    debtPayments: [] as DebtPayment[],
    cashExpenses: [] as CashExpense[],
    supplierPayments: [],
    cashDrawerAdjustments: [],
    dayDrawerOpens: [],
    dayCloses: [],
    shifts: [],
    formulaVersion: "v2",
    cashSafeLimitUgx: null as number | null,
    lang: "en",
    shopName: "Shop",
    generalCategoryLabel: "General",
    todayKey: DAY,
  };

  it("unchanged inputs preserve the same fingerprint", () => {
    expect(buildCashPositionDashboardFingerprint(base)).toBe(
      buildCashPositionDashboardFingerprint({ ...base }),
    );
  });

  it("product category change invalidates fingerprint", () => {
    const a = buildCashPositionDashboardFingerprint(base);
    const b = buildCashPositionDashboardFingerprint({
      ...base,
      products: [{ ...products[0]!, category: "Beverages", version: 2 }],
    });
    expect(a).not.toBe(b);
  });

  it("staff/cashier change invalidates fingerprint", () => {
    const a = buildCashPositionDashboardFingerprint(base);
    const b = buildCashPositionDashboardFingerprint({
      ...base,
      staffAccounts: [{ ...base.staffAccounts[0]!, name: "Ann Renamed" }],
    });
    expect(a).not.toBe(b);
  });

  it("different shops cannot share the same fingerprint", () => {
    const a = buildCashPositionDashboardFingerprint(base);
    const b = buildCashPositionDashboardFingerprint({ ...base, shopId: SHOP_B });
    expect(a).not.toBe(b);
  });
});

describe("CASH-POSITION-CORRECTIONS-1.0 P1-05 immediate sync shop stamp", () => {
  it("Shop A stamp remains A and does not rewrite to B", () => {
    expect(stampedShopIdForImmediateCashSync(SHOP_A)).toBe(SHOP_A);
    expect(stampedShopIdForImmediateCashSync(SHOP_A)).not.toBe(SHOP_B);
  });

  it("missing shop identity fails closed", () => {
    expect(stampedShopIdForImmediateCashSync(undefined)).toBeNull();
    expect(stampedShopIdForImmediateCashSync(null)).toBeNull();
    expect(stampedShopIdForImmediateCashSync("not-a-uuid")).toBeNull();
  });

  it("same-shop stamp is accepted", () => {
    expect(stampedShopIdForImmediateCashSync(SHOP_B)).toBe(SHOP_B);
  });
});
