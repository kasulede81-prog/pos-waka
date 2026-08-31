/**
 * COMMAND-CENTER-P1-CORRECTIONS-1.0 — payment mix, expected-cash range, profit merge, costIncomplete.
 */
import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import { attributeSalePaymentBuckets } from "./cashPosition";
import { buildCommandCenterExportText, buildKpiCards } from "./commandCenterPageView";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import {
  computeTodayProfitBreakdown,
  mergeLinkedReturnsForScopedSales,
} from "./homeProfit";
import {
  buildCashControlExtended,
  buildFinancialExtended,
  paymentMixFromRevenueSales,
} from "./ownerCommandCenterBuilders";
import { buildOwnerCommandCenterContext } from "./ownerCommandCenterContext";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { isRevenueSale } from "./saleStatus";
import { t } from "./i18n";
import type { DateFilterBounds } from "./dateFilters";

const shopPrefs = {
  businessType: "kiosk_duka",
  kioskQuickSell: true,
  onboardingDone: true,
  schemaVersion: 2,
} as never;

const DAY1 = "2026-08-10";
const DAY2 = "2026-08-11";

const products: Product[] = [
  {
    id: "prod-1",
    name: "Widget",
    sellingPricePerUnitUgx: 100_000,
    costPricePerUnitUgx: 60_000,
    stockOnHand: 50,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt: `${DAY1}T09:00:00.000Z`,
    version: 1,
  },
];
const productById = new Map(products.map((p) => [p.id, p]));

function line(partial: Partial<SaleLine> & Pick<SaleLine, "lineTotalUgx">): SaleLine {
  const qty = partial.quantity ?? 1;
  const total = partial.lineTotalUgx;
  const unitCost = partial.unitCostUgx ?? 0;
  const cogs = partial.cogsUgx ?? Math.round(unitCost * qty);
  const net = partial.netRevenueUgx ?? total;
  const gp = partial.grossProfitUgx ?? net - cogs;
  return {
    productId: "prod-1",
    name: partial.name ?? "Widget",
    quantity: qty,
    unitPriceUgx: total / qty,
    unitCostUgx: unitCost,
    cogsUgx: cogs,
    netRevenueUgx: net,
    grossProfitUgx: gp,
    estimatedProfitUgx: gp,
    inputMode: "quantity",
    voided: partial.voided,
    financialDataStatus: partial.financialDataStatus,
    lineTotalUgx: total,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx"> & { day?: string }): Sale {
  const day = partial.day ?? DAY1;
  const at = `${day}T10:00:00.000Z`;
  const { day: _d, lines: customLines, createdAt: _c, updatedAt: _u, ...rest } = partial;
  const unitCost = 60_000;
  const total = partial.totalUgx;
  return {
    status: "completed",
    subtotalUgx: total,
    cashPaidUgx: partial.cashPaidUgx ?? total,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: total - unitCost,
    lines: customLines ?? [
      line({
        lineTotalUgx: total,
        unitCostUgx: unitCost,
        cogsUgx: unitCost,
        netRevenueUgx: total,
        grossProfitUgx: total - unitCost,
        estimatedProfitUgx: total - unitCost,
      }),
    ],
    pendingSync: false,
    ...rest,
    createdAt: at,
    updatedAt: at,
  };
}

function ret(partial: {
  id: string;
  saleId: string;
  refundAmountUgx: number;
  day: string;
  cogsUgx?: number;
}): ReturnRecord {
  return {
    id: partial.id,
    saleId: partial.saleId,
    productId: "prod-1",
    productName: "Widget",
    quantity: 1,
    reason: "wrong_item",
    actorUserId: "owner",
    actorName: "Owner",
    shiftId: null,
    createdAt: `${partial.day}T14:00:00.000Z`,
    refundAmountUgx: partial.refundAmountUgx,
    cogsUgx: partial.cogsUgx ?? Math.round((60_000 * partial.refundAmountUgx) / 100_000),
  };
}

const dayBounds: DateFilterBounds = { fromKey: DAY1, toKey: DAY1, isSingleDay: true };
const rangeBounds: DateFilterBounds = { fromKey: DAY1, toKey: DAY2, isSingleDay: false };

describe("COMMAND-CENTER-P1-CORRECTIONS-1.0", () => {
  it("P1-01 — payment mix uses attributeSalePaymentBuckets (mixed/credit split)", () => {
    const mixed = sale({
      id: "mix-1",
      totalUgx: 100_000,
      cashPaidUgx: 40_000,
      debtUgx: 60_000,
      paymentMethod: "mixed",
    });
    const momo = sale({
      id: "mm-1",
      totalUgx: 50_000,
      cashPaidUgx: 50_000,
      paymentMethod: "mobile_money",
    });
    const atm = sale({
      id: "atm-1",
      totalUgx: 30_000,
      cashPaidUgx: 30_000,
      paymentMethod: "atm",
    });

    const mix = paymentMixFromRevenueSales([mixed, momo, atm]);
    const expected = [mixed, momo, atm].reduce(
      (acc, s) => {
        const b = attributeSalePaymentBuckets(s);
        return {
          cash: acc.cash + b.cash,
          mobile_money: acc.mobile_money + b.mobile_money,
          card: acc.card + b.card,
          credit: acc.credit + b.credit,
        };
      },
      { cash: 0, mobile_money: 0, card: 0, credit: 0 },
    );

    expect(mix.cashUgx).toBe(expected.cash);
    expect(mix.mobileMoneyUgx).toBe(expected.mobile_money);
    expect(mix.atmUgx).toBe(expected.card);
    expect(mix.creditUgx).toBe(expected.credit);
    expect(mix.mixedUgx).toBe(0);
    // Must not attribute full totalUgx to "mixed"
    expect(mix.cashUgx).toBe(40_000);
    expect(mix.creditUgx).toBe(60_000);
  });

  it("P1-02 — multi-day expected / counted / variance are null (not summed)", () => {
    const cash = buildCashControlExtended({
      bounds: rangeBounds,
      primaryDayKey: DAY2,
      dayDrawerOpens: [],
      dayCloses: [
        {
          id: "c1",
          dateKey: DAY2,
          expectedCashUgx: 700_000,
          countedCashUgx: 690_000,
          differenceUgx: -10_000,
          totalSalesUgx: 100_000,
          totalDebtUgx: 0,
          profitEstimateUgx: 40_000,
          createdAt: `${DAY2}T20:00:00.000Z`,
          updatedAt: `${DAY2}T20:00:00.000Z`,
          closedByUserId: "owner",
          closedByLabel: "Owner",
          pendingSync: false,
        },
      ],
      shifts: [],
      cashDrawerAdjustments: [],
      cashExpenses: [],
      expectedCashUgx: null,
      lang: "en",
    });
    expect(cash.periodExpectedCashUgx).toBeNull();
    expect(cash.latestCountedCashUgx).toBeNull();
    expect(cash.latestDayVarianceUgx).toBeNull();
    expect(cash.isPeriodRange).toBe(true);

    const cards = buildKpiCards(
      {
        revenueUgx: 0,
        profitUgx: 0,
        transactionCount: 0,
        costIncomplete: false,
        debtCollectedUgx: 0,
        receivablesUgx: 0,
        payablesUgx: 0,
        expensesTodayUgx: 0,
        expensesPeriodUgx: 0,
        expensesPriorPeriodUgx: 0,
        purchasesUgx: 0,
        debtIssuedUgx: 0,
        topSuppliers: [],
        paymentMix: {
          cashUgx: 0,
          mobileMoneyUgx: 0,
          atmUgx: 0,
          creditUgx: 0,
          mixedUgx: 0,
          otherUgx: 0,
        },
        trendVsPriorDay: null,
        trendVsPriorWeek: null,
        trendVsPriorMonth: null,
      },
      null,
      0,
      [],
    );
    expect(cards.find((c) => c.id === "expected-cash")?.value).toBe("—");
  });

  it("P1-03 — cross-day linked return merges like Profit page", () => {
    const original = sale({ id: "sale-1", totalUgx: 100_000, day: DAY1 });
    const crossDayReturn = ret({
      id: "ret-1",
      saleId: "sale-1",
      refundAmountUgx: 100_000,
      day: DAY2,
      cogsUgx: 60_000,
    });
    const reduced = { ...original, ...reduceSaleTotalsByAmount(original, 100_000) };

    const ctx = buildOwnerCommandCenterContext({
      lang: "en",
      bounds: dayBounds,
      sales: [reduced],
      products,
      auditLogs: [],
      returnRecords: [crossDayReturn],
      voidRecords: [],
      dayCloses: [],
      preferences: {
        businessType: "kiosk_duka",
        kioskQuickSell: true,
        onboardingDone: true,
        schemaVersion: 2,
      } as never,
    });

    const profitReturns = mergeLinkedReturnsForScopedSales([reduced], [], [crossDayReturn]);
    const profit = computeTodayProfitBreakdown([reduced], productById, profitReturns);

    expect(ctx.overview.revenueUgx).toBe(0);
    expect(ctx.overview.profitUgx).toBe(0);
    expect(ctx.overview.revenueUgx).toBe(profit.salesUgx);
    expect(ctx.overview.profitUgx).toBe(profit.profitUgx);
    expect(ctx.overview.revenueUgx).toBe(computeCanonicalRevenueUgx([reduced], profitReturns));

    // Without merge, sale-day would still show COGS / inflated profit.
    const legacy = computeTodayProfitBreakdown([reduced], productById, []);
    expect(legacy.profitUgx).toBe(40_000);
  });

  it("P1-04 — costIncomplete when historical unit cost is missing", () => {
    const s = sale({
      id: "no-cost",
      totalUgx: 100_000,
      lines: [
        line({
          lineTotalUgx: 100_000,
          unitCostUgx: 0,
          cogsUgx: 0,
          grossProfitUgx: 100_000,
          estimatedProfitUgx: 100_000,
        }),
      ],
    });
    const ctx = buildOwnerCommandCenterContext({
      lang: "en",
      bounds: dayBounds,
      sales: [s],
      products,
      auditLogs: [],
      returnRecords: [],
      voidRecords: [],
      dayCloses: [],
      preferences: shopPrefs,
    });
    expect(ctx.overview.costIncomplete).toBe(true);

    const fin = buildFinancialExtended({
      sales: [s],
      returnRecords: [],
      products,
      customers: [],
      suppliers: [],
      purchases: [],
      debtPayments: [],
      cashExpenses: [],
      bounds: dayBounds,
      currentPeriod: {
        revenueUgx: ctx.overview.revenueUgx,
        profitUgx: ctx.overview.profitUgx,
        transactionCount: ctx.overview.transactionCount,
        costIncomplete: ctx.overview.costIncomplete,
      },
    });
    expect(fin.costIncomplete).toBe(true);

    const cards = buildKpiCards(fin, 0, 0, []);
    expect(cards.find((c) => c.id === "profit")?.labelKey).toBe("profitGrossProfitEstimated");
    expect(t("en", "profitGrossProfitEstimated")).toMatch(/estimated/i);
  });

  it("P1-05 — Gross profit terminology (not Net Profit)", () => {
    expect(t("en", "cmdCenterKpiProfit")).toBe("Gross profit");
    expect(t("en", "ownerFinancialProfit")).toBe("Gross profit");
    expect(t("en", "cmdCenterKpiProfit").toLowerCase()).not.toContain("net");

    const text = buildCommandCenterExportText({
      shopName: "Test",
      periodLabel: "Today",
      score: 90,
      revenueUgx: 100_000,
      profitUgx: 40_000,
      transactions: 1,
      expectedCashUgx: 50_000,
    });
    expect(text).toContain("Gross profit:");
    expect(text).not.toMatch(/Net Profit/i);
  });

  it("P1-06 — whole-bill void excluded from Command Center revenue/profit/txn", () => {
    const voided = sale({
      id: "void-1",
      totalUgx: 0,
      cashPaidUgx: 0,
      saleVoidedAt: `${DAY1}T12:00:00.000Z`,
      lines: [
        line({
          lineTotalUgx: 0,
          unitCostUgx: 60_000,
          voided: true,
          cogsUgx: 0,
          netRevenueUgx: 0,
          grossProfitUgx: 0,
          estimatedProfitUgx: 0,
        }),
      ],
    });
    expect(isRevenueSale(voided)).toBe(false);

    const ok = sale({ id: "ok", totalUgx: 100_000 });
    const ctx = buildOwnerCommandCenterContext({
      lang: "en",
      bounds: dayBounds,
      sales: [voided, ok],
      products,
      auditLogs: [],
      returnRecords: [],
      voidRecords: [],
      dayCloses: [],
      preferences: shopPrefs,
    });
    expect(ctx.overview.transactionCount).toBe(1);
    expect(ctx.overview.revenueUgx).toBe(100_000);
    expect(ctx.overview.profitUgx).toBe(40_000);
  });
});
