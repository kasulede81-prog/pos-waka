import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, ReturnRecord, Sale, SaleLine } from "../types";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import { resolvePeriodReportAuthority } from "./closedDayAuthority";
import {
  computeProfitGroupedByCategory,
  computeTodayProfitBreakdown,
  mergeLinkedReturnsForScopedSales,
} from "./homeProfit";
import { resolveProfitHeadlineCostUgx } from "./profitPageView";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { isRevenueSale } from "./saleStatus";

const DAY1 = "2026-08-01";
const DAY2 = "2026-08-02";
const DAY3 = "2026-08-03";

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

function line(partial: Partial<SaleLine> & Pick<SaleLine, "lineTotalUgx" | "unitCostUgx">): SaleLine {
  const qty = partial.quantity ?? 1;
  const total = partial.lineTotalUgx;
  const unitCost = partial.unitCostUgx;
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
    estimatedProfitUgx: partial.estimatedProfitUgx ?? gp,
    inputMode: "quantity",
    voided: partial.voided,
    voidedAt: partial.voidedAt,
    lineTotalUgx: total,
  };
}

function sale(
  partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx"> & { day?: string },
): Sale {
  const day = partial.day ?? DAY1;
  const at = `${day}T10:00:00.000Z`;
  const total = partial.totalUgx;
  const debt = partial.debtUgx ?? 0;
  const unitCost = 60_000;
  const cogs = Math.round(unitCost);
  const { day: _day, lines: customLines, createdAt: _c, updatedAt: _u, ...rest } = partial;
  return {
    status: "completed",
    subtotalUgx: total,
    cashPaidUgx: partial.cashPaidUgx ?? Math.max(0, total - debt),
    debtUgx: debt,
    estimatedProfitUgx: total - cogs,
    lines: customLines ?? [
      line({
        lineTotalUgx: total,
        unitCostUgx: unitCost,
        cogsUgx: cogs,
        netRevenueUgx: total,
        grossProfitUgx: total - cogs,
        estimatedProfitUgx: total - cogs,
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
  const day = partial.day;
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
    createdAt: `${day}T14:00:00.000Z`,
    refundAmountUgx: partial.refundAmountUgx,
    cogsUgx: partial.cogsUgx ?? Math.round((60_000 * partial.refundAmountUgx) / 100_000),
  };
}

/** Mirrors ProfitPage financial scope after P1 corrections. */
function profitScope(sales: Sale[], dateReturns: ReturnRecord[], allReturns: ReturnRecord[]) {
  const scoped = sales.filter(isRevenueSale);
  const profitReturns = mergeLinkedReturnsForScopedSales(scoped, dateReturns, allReturns);
  const breakdown = computeTodayProfitBreakdown(scoped, productById, profitReturns);
  return {
    scoped,
    profitReturns,
    ...breakdown,
    transactionCount: scoped.length,
    averageSaleUgx: scoped.length > 0 ? Math.round(breakdown.salesUgx / scoped.length) : 0,
    averageProfitUgx: scoped.length > 0 ? Math.round(breakdown.profitUgx / scoped.length) : 0,
  };
}

describe("PROFIT-P1-CORRECTIONS-1.0", () => {
  it("T1 — whole-bill void excluded from revenue, txn, avg, profit", () => {
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
    const kpis = profitScope([voided], [], []);
    expect(kpis.transactionCount).toBe(0);
    expect(kpis.salesUgx).toBe(0);
    expect(kpis.profitUgx).toBe(0);
    expect(kpis.costUgx).toBe(0);
    expect(kpis.averageSaleUgx).toBe(0);
  });

  it("T2 — normal completed sale included", () => {
    const s = sale({ id: "ok", totalUgx: 100_000, paymentMethod: "cash" });
    const kpis = profitScope([s], [], []);
    expect(kpis.transactionCount).toBe(1);
    expect(kpis.salesUgx).toBe(100_000);
    expect(kpis.costUgx).toBe(60_000);
    expect(kpis.profitUgx).toBe(40_000);
    expect(kpis.salesUgx - kpis.costUgx).toBe(kpis.profitUgx);
  });

  it("T3 — line void preserved (active remainder still revenue-eligible)", () => {
    const s = sale({
      id: "line-void",
      totalUgx: 60_000,
      lines: [
        line({
          name: "Kept",
          lineTotalUgx: 60_000,
          unitCostUgx: 36_000,
          cogsUgx: 36_000,
          netRevenueUgx: 60_000,
          grossProfitUgx: 24_000,
          estimatedProfitUgx: 24_000,
        }),
        line({
          name: "Voided",
          lineTotalUgx: 40_000,
          unitCostUgx: 24_000,
          voided: true,
          cogsUgx: 24_000,
          netRevenueUgx: 40_000,
          grossProfitUgx: 16_000,
        }),
      ],
    });
    expect(isRevenueSale(s)).toBe(true);
    const kpis = profitScope([s], [], []);
    expect(kpis.salesUgx).toBe(60_000);
    expect(kpis.costUgx).toBe(36_000);
    expect(kpis.profitUgx).toBe(24_000);
  });

  it("T4 — same-day linked return: no double subtraction", () => {
    const original = sale({ id: "same-day", totalUgx: 100_000 });
    const linked = ret({ id: "r1", saleId: original.id, refundAmountUgx: 40_000, day: DAY1, cogsUgx: 24_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 40_000) };
    const kpis = profitScope([adjusted], [linked], [linked]);
    expect(computeCanonicalRevenueUgx([adjusted], [linked])).toBe(60_000);
    expect(kpis.salesUgx).toBe(60_000);
    expect(kpis.costUgx).toBe(36_000);
    expect(kpis.profitUgx).toBe(24_000);
    expect(kpis.salesUgx - kpis.costUgx).toBe(kpis.profitUgx);
  });

  it("T5 — cross-day linked return: sale-day R/COGS/GP coherent", () => {
    const original = sale({ id: "cross", totalUgx: 100_000, day: DAY1 });
    const linked = ret({ id: "r-cross", saleId: original.id, refundAmountUgx: 100_000, day: DAY2, cogsUgx: 60_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 100_000) };
    expect(adjusted.totalUgx).toBe(0);

    // Sale-day filter only (return outside date scope) — merge brings linked return in.
    const dateScopedReturns: ReturnRecord[] = [];
    const kpis = profitScope([adjusted], dateScopedReturns, [linked]);
    expect(kpis.salesUgx).toBe(0);
    expect(kpis.costUgx).toBe(0);
    expect(kpis.profitUgx).toBe(0);
    expect(kpis.salesUgx - kpis.costUgx).toBe(kpis.profitUgx);

    // Without merge (legacy asymmetry) would leave COGS on sale day:
    const legacy = computeTodayProfitBreakdown([adjusted], productById, []);
    expect(legacy.salesUgx).toBe(0);
    expect(legacy.costUgx).toBe(60_000);
    expect(legacy.profitUgx).toBe(40_000);
  });

  it("T6–T10 — tender-independent revenue/profit", () => {
    const base = { totalUgx: 100_000 as const };
    const cash = sale({ id: "cash", ...base, paymentMethod: "cash" });
    const momo = sale({ id: "momo", ...base, paymentMethod: "mobile_money" });
    const atm = sale({ id: "atm", ...base, paymentMethod: "atm" });
    const credit = sale({ id: "credit", ...base, paymentMethod: "credit", cashPaidUgx: 0, debtUgx: 100_000 });
    const mixed = sale({
      id: "mixed",
      totalUgx: 100_000,
      paymentMethod: "mixed",
      cashPaidUgx: 60_000,
      debtUgx: 40_000,
    });

    for (const s of [cash, momo, atm, credit, mixed]) {
      const kpis = profitScope([s], [], []);
      expect(kpis.salesUgx).toBe(100_000);
      expect(kpis.profitUgx).toBe(40_000);
    }
  });

  it("T11 — closed-day headline cost derived from overlaid R − P", () => {
    const liveCost = 999_999;
    const cost = resolveProfitHeadlineCostUgx({
      closedPeriod: true,
      revenueUgx: 100_000,
      profitUgx: 40_000,
      liveCostUgx: liveCost,
    });
    expect(cost).toBe(60_000);
    expect(cost).not.toBe(liveCost);
    expect(100_000 - cost).toBe(40_000);

    expect(
      resolveProfitHeadlineCostUgx({
        closedPeriod: false,
        revenueUgx: 100_000,
        profitUgx: 40_000,
        liveCostUgx: liveCost,
      }),
    ).toBe(liveCost);
  });

  it("T11b — closed period authority detection", () => {
    const close: DayCloseSummary = {
      id: "close-1",
      dateKey: DAY1,
      expectedCashUgx: 0,
      countedCashUgx: 0,
      differenceUgx: 0,
      totalSalesUgx: 100_000,
      totalDebtUgx: 0,
      profitEstimateUgx: 40_000,
      createdAt: `${DAY1}T20:00:00.000Z`,
      pendingSync: false,
      supersededAt: null,
    };
    expect(resolvePeriodReportAuthority([close], { fromKey: DAY1, toKey: DAY1, isSingleDay: true })).toBe(
      "closed_snapshot",
    );
    expect(resolvePeriodReportAuthority([], { fromKey: DAY1, toKey: DAY1, isSingleDay: true })).toBe("live");
  });

  it("T12 — range flow totals sum revenue sales only", () => {
    const a = sale({ id: "a", totalUgx: 100_000, day: DAY1 });
    const b = sale({ id: "b", totalUgx: 50_000, day: DAY3 });
    const voided = sale({
      id: "c",
      totalUgx: 0,
      day: DAY2,
      saleVoidedAt: `${DAY2}T12:00:00.000Z`,
      lines: [line({ lineTotalUgx: 0, unitCostUgx: 0, voided: true, cogsUgx: 0, netRevenueUgx: 0, grossProfitUgx: 0 })],
    });
    const kpis = profitScope([a, b, voided], [], []);
    expect(kpis.transactionCount).toBe(2);
    expect(kpis.salesUgx).toBe(150_000);
    expect(kpis.averageSaleUgx).toBe(75_000);
    const grouped = computeProfitGroupedByCategory(kpis.scoped, productById, "General", []);
    expect(grouped.total.salesUgx).toBe(150_000);
  });
});
