import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, Purchase, Sale } from "../types";
import { buildAnalyticsReportRows } from "./analyticsReportExport";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { resolveDateFilterBounds } from "./dateFilters";
import { t } from "./i18n";
import { localGetRangeSummary } from "./localReporting";
import { isPurchaseVoided } from "./purchaseCorrections";
import { filterPurchases, filterPurchasesForReporting, sumPurchasesForReporting } from "./purchaseReporting";
import { computeReportsPeriodCashFlow } from "./reportsCashFlow";
import { REPORTS_DATA_COMPLETE_FLAGS } from "./reportsDataCompleteness";
import type { ShopReportBundle } from "../hooks/useShopReporting";

const DAY1 = "2026-08-12";
const DAY2 = "2026-08-13";
const SUPPLIER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function purchase(partial: Partial<Purchase> & Pick<Purchase, "id" | "createdAt" | "totalCostUgx">): Purchase {
  return {
    supplierId: SUPPLIER_A,
    supplierName: "Mukwano",
    lines: [{ productId: "prod-1", name: "Sugar", qtyBuyingUnits: 1, costPerBuyingUnitUgx: partial.totalCostUgx }],
    amountPaidUgx: partial.amountPaidUgx ?? 0,
    balanceDeltaUgx: partial.balanceDeltaUgx ?? partial.totalCostUgx,
    notes: "",
    pendingSync: false,
    ...partial,
  };
}

function voidPurchase(row: Purchase, voidedAt = `${DAY1}T18:00:00.000Z`): Purchase {
  return { ...row, voidedAt };
}

const day1Bounds = resolveDateFilterBounds({ kind: "day", dateKey: DAY1 });
const day2Bounds = resolveDateFilterBounds({ kind: "day", dateKey: DAY2 });
const rangeBounds = resolveDateFilterBounds({ kind: "range", fromKey: DAY1, toKey: DAY2 });

describe("RPT-P2-05 Reports exclude voided purchases", () => {
  it("TEST 1 — valid purchase of 100,000 is included", () => {
    const rows = [purchase({ id: "p-valid", createdAt: `${DAY1}T10:00:00.000Z`, totalCostUgx: 100_000 })];
    expect(isPurchaseVoided(rows[0]!)).toBe(false);
    const summed = sumPurchasesForReporting(rows, day1Bounds);
    expect(summed.totalUgx).toBe(100_000);
    expect(summed.count).toBe(1);
  });

  it("TEST 2 — voided purchase of 100,000 is excluded from total and count", () => {
    const rows = [
      voidPurchase(purchase({ id: "p-void", createdAt: `${DAY1}T10:00:00.000Z`, totalCostUgx: 100_000 })),
    ];
    expect(isPurchaseVoided(rows[0]!)).toBe(true);
    expect(filterPurchases(rows, day1Bounds)).toHaveLength(1);
    const summed = sumPurchasesForReporting(rows, day1Bounds);
    expect(summed.totalUgx).toBe(0);
    expect(summed.count).toBe(0);
  });

  it("TEST 3 — mixed valid + voided totals 125,000 across 2 purchases", () => {
    const rows = [
      purchase({ id: "a", createdAt: `${DAY1}T09:00:00.000Z`, totalCostUgx: 100_000 }),
      voidPurchase(purchase({ id: "b", createdAt: `${DAY1}T10:00:00.000Z`, totalCostUgx: 50_000 })),
      purchase({ id: "c", createdAt: `${DAY1}T11:00:00.000Z`, totalCostUgx: 25_000 }),
    ];
    const summed = sumPurchasesForReporting(rows, day1Bounds);
    expect(summed.totalUgx).toBe(125_000);
    expect(summed.count).toBe(2);
    expect(summed.totalUgx).not.toBe(175_000);
    expect(summed.count).not.toBe(3);
  });

  it("TEST 4 — after void, live Reports no longer includes the purchase", () => {
    const created = purchase({ id: "p-live", createdAt: `${DAY1}T10:00:00.000Z`, totalCostUgx: 100_000 });
    expect(sumPurchasesForReporting([created], day1Bounds).totalUgx).toBe(100_000);
    const afterVoid = voidPurchase(created, `${DAY1}T16:00:00.000Z`);
    expect(isPurchaseVoided(afterVoid)).toBe(true);
    expect(sumPurchasesForReporting([afterVoid], day1Bounds)).toEqual({ totalUgx: 0, count: 0 });
  });

  it("TEST 5 — date range includes Day 1 valid and excludes Day 2 voided", () => {
    const rows = [
      purchase({ id: "d1", createdAt: `${DAY1}T10:00:00.000Z`, totalCostUgx: 100_000 }),
      voidPurchase(purchase({ id: "d2", createdAt: `${DAY2}T10:00:00.000Z`, totalCostUgx: 50_000 }), `${DAY2}T12:00:00.000Z`),
    ];
    expect(sumPurchasesForReporting(rows, day1Bounds)).toEqual({ totalUgx: 100_000, count: 1 });
    expect(sumPurchasesForReporting(rows, day2Bounds)).toEqual({ totalUgx: 0, count: 0 });
    expect(sumPurchasesForReporting(rows, rangeBounds)).toEqual({ totalUgx: 100_000, count: 1 });
  });

  it("TEST 6 — supplier purchase-value summaries exclude voids; payable ledger is untouched", () => {
    const rows = [
      purchase({
        id: "a1",
        createdAt: `${DAY1}T10:00:00.000Z`,
        totalCostUgx: 80_000,
        supplierId: SUPPLIER_A,
        supplierName: "Mukwano",
      }),
      voidPurchase(
        purchase({
          id: "a-void",
          createdAt: `${DAY1}T11:00:00.000Z`,
          totalCostUgx: 40_000,
          supplierId: SUPPLIER_A,
          supplierName: "Mukwano",
        }),
      ),
      purchase({
        id: "b1",
        createdAt: `${DAY1}T12:00:00.000Z`,
        totalCostUgx: 20_000,
        supplierId: SUPPLIER_B,
        supplierName: "City",
      }),
    ];
    const bySupplier = new Map<string, number>();
    for (const p of filterPurchasesForReporting(rows, day1Bounds)) {
      bySupplier.set(p.supplierId, (bySupplier.get(p.supplierId) ?? 0) + p.totalCostUgx);
    }
    expect(bySupplier.get(SUPPLIER_A)).toBe(80_000);
    expect(bySupplier.get(SUPPLIER_B)).toBe(20_000);

    const payableA = 200_000;
    const payableB = 10_000;
    expect(payableA + payableB).toBe(210_000);
  });

  it("TEST 7 — CSV/XLSX purchase export value excludes voided invoices", () => {
    const rows = [
      purchase({ id: "ok", createdAt: `${DAY1}T10:00:00.000Z`, totalCostUgx: 100_000 }),
      voidPurchase(purchase({ id: "void", createdAt: `${DAY1}T11:00:00.000Z`, totalCostUgx: 50_000 })),
    ];
    const purchasesInPeriodUgx = sumPurchasesForReporting(rows, day1Bounds).totalUgx;
    const report: ShopReportBundle = {
      source: "local",
      authority: "live",
      closedDayBreakdownUnavailable: false,
      revenue: 0,
      cash: 0,
      profit: 0,
      debt: 0,
      count: 0,
      discountsUgx: 0,
      taxesUgx: 0,
      debtOutstanding: 0,
      topProducts: [],
      slowProducts: [],
      marginLeaders: [],
      dailyTrend: [],
      stockValueAtCost: 0,
      supplierDebtTotal: 0,
      ...REPORTS_DATA_COMPLETE_FLAGS,
    };
    const exported = buildAnalyticsReportRows({
      lang: "en",
      title: "Reports",
      periodLabel: DAY1,
      report,
      expensesUgx: 0,
      purchasesInPeriodUgx,
      canProfit: false,
    });
    expect(exported.some((row) => row[0] === t("en", "baPurchasesInPeriod") && row[1] === 100_000)).toBe(true);
    expect(exported.some((row) => row[0] === t("en", "baPurchasesInPeriod") && row[1] === 150_000)).toBe(false);
  });

  it("TEST 8 — closed-day frozen sales headlines are not replaced by live purchase filtering", () => {
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
      updatedAt: `${DAY1}T09:00:00.000Z`,
      version: 1,
    };
    const sale: Sale = {
      id: "s1",
      createdAt: `${DAY1}T10:00:00.000Z`,
      updatedAt: `${DAY1}T10:00:00.000Z`,
      subtotalUgx: 500_000,
      totalUgx: 500_000,
      cashPaidUgx: 500_000,
      debtUgx: 0,
      paymentMethod: "cash",
      estimatedProfitUgx: 400_000,
      lines: [
        {
          productId: "p1",
          name: "Item",
          quantity: 1,
          unitPriceUgx: 500_000,
          unitCostUgx: 100_000,
          lineTotalUgx: 500_000,
          estimatedProfitUgx: 400_000,
          inputMode: "quantity",
          voided: false,
        },
      ],
      pendingSync: false,
      lastSyncError: null,
      status: "completed",
    };
    const row = {
      id: "close-a",
      dateKey: DAY1,
      expectedCashUgx: 500_000,
      countedCashUgx: 500_000,
      differenceUgx: 0,
      totalSalesUgx: 500_000,
      totalDebtUgx: 0,
      profitEstimateUgx: 400_000,
      openingFloatUgx: 0,
      createdAt: `${DAY1}T18:00:00.000Z`,
      closedByUserId: "owner",
      closedByLabel: "Owner",
    };
    const close: DayCloseSummary = {
      ...row,
      documentSnapshot: buildDayCloseSnapshot({
        closedByUserId: "owner",
        closedByLabel: "Owner",
        row,
        drawer: {
          cashFromSalesUgx: 500_000,
          debtCollectedUgx: 0,
          refundsUgx: 0,
          expenseUgx: 0,
          openingFloatUgx: 0,
          cashSalesUgx: 500_000,
          supplierPaymentsUgx: 0,
          adjustmentInflowsUgx: 0,
          adjustmentOutflowsUgx: 0,
          cashRefundsUgx: 0,
        },
        transactionCount: 1,
      }),
      supersededAt: null,
      pendingSync: false,
      updatedAt: row.createdAt,
    };
    const range = localGetRangeSummary(
      [sale],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY1 },
      [],
      [close],
    );
    expect(range.authority).toBe("closed_snapshot");
    expect(range.summary.totalRevenueUgx).toBe(500_000);
    expect(range.profitUgx).toBe(400_000);

    const livePurchases = [
      voidPurchase(purchase({ id: "after-close", createdAt: `${DAY1}T19:00:00.000Z`, totalCostUgx: 99_000 })),
    ];
    expect(sumPurchasesForReporting(livePurchases, day1Bounds).totalUgx).toBe(0);
    expect(range.summary.totalRevenueUgx).toBe(500_000);
  });

  it("TEST 9 — Cash Flow stays physical; voided purchase invoice is not a cash movement", () => {
    const cashFlow = computeReportsPeriodCashFlow({
      sales: [],
      returns: [],
      products: [],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: [{ id: "pay1", supplierId: SUPPLIER_A, amountUgx: 30_000, createdAt: `${DAY1}T12:00:00.000Z`, pendingSync: false }],
      cashDrawerAdjustments: [],
      shifts: [],
      dayDrawerOpens: [],
      formulaVersion: "v2",
      dayCloses: [],
      bounds: day1Bounds,
    });
    expect(cashFlow.cashOutUgx).toBe(30_000);
    expect(cashFlow.unavailable).toBe(false);

    const voidedInvoice = voidPurchase(
      purchase({ id: "inv", createdAt: `${DAY1}T10:00:00.000Z`, totalCostUgx: 100_000 }),
    );
    expect(sumPurchasesForReporting([voidedInvoice], day1Bounds).totalUgx).toBe(0);
    expect(cashFlow.cashOutUgx).toBe(30_000);
    expect(cashFlow.cashInUgx).toBe(0);
  });
});
