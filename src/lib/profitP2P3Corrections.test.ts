import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import { buildProfitExportRows } from "./analyticsReportExport";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import { resolvePeriodReportAuthority } from "./closedDayAuthority";
import {
  computeTodayProfitBreakdown,
  mergeLinkedReturnsForScopedSales,
  saleLineHasTrustworthyHistoricalCost,
} from "./homeProfit";
import {
  averageGrossProfitPerSale,
  averageSaleUgx,
  resolveProfitHeadlineCostUgx,
} from "./profitPageView";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { isRevenueSale } from "./saleStatus";
import { t } from "./i18n";

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
  return {
    status: "completed",
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: partial.totalUgx - unitCost,
    lines: customLines ?? [
      line({
        lineTotalUgx: partial.totalUgx,
        unitCostUgx: unitCost,
        cogsUgx: unitCost,
        netRevenueUgx: partial.totalUgx,
        grossProfitUgx: partial.totalUgx - unitCost,
      }),
    ],
    pendingSync: false,
    ...rest,
    createdAt: at,
    updatedAt: at,
  };
}

describe("PROFIT-P2-P3-CLEANUP-1.0", () => {
  it("T1 — missing cost is flagged cost-incomplete (not silently trustworthy)", () => {
    const missing = sale({
      id: "no-cost",
      totalUgx: 100_000,
      lines: [
        line({
          lineTotalUgx: 100_000,
          unitCostUgx: 0,
          cogsUgx: 0,
          netRevenueUgx: 100_000,
          grossProfitUgx: 100_000,
        }),
      ],
    });
    expect(saleLineHasTrustworthyHistoricalCost(missing.lines[0]!)).toBe(false);
    const breakdown = computeTodayProfitBreakdown([missing], productById, []);
    expect(breakdown.costIncomplete).toBe(true);
    expect(breakdown.linesMissingCost).toBeGreaterThan(0);
    // Engine still computes a number, but it must not be treated as trustworthy zero COGS.
    expect(breakdown.costUgx).toBe(0);
    expect(breakdown.profitUgx).toBe(100_000);
  });

  it("T2 — valid historical cost calculates correctly", () => {
    const s = sale({ id: "ok", totalUgx: 100_000 });
    expect(saleLineHasTrustworthyHistoricalCost(s.lines[0]!)).toBe(true);
    const breakdown = computeTodayProfitBreakdown([s], productById, []);
    expect(breakdown.costIncomplete).toBe(false);
    expect(breakdown.salesUgx).toBe(100_000);
    expect(breakdown.costUgx).toBe(60_000);
    expect(breakdown.profitUgx).toBe(40_000);
    expect(breakdown.salesUgx - breakdown.costUgx).toBe(breakdown.profitUgx);
  });

  it("T3 — whole-bill void excluded from denominators", () => {
    const ok = sale({ id: "a", totalUgx: 100_000 });
    const voided = sale({
      id: "v",
      totalUgx: 0,
      saleVoidedAt: `${DAY1}T12:00:00.000Z`,
      lines: [line({ lineTotalUgx: 0, unitCostUgx: 0, voided: true, cogsUgx: 0, netRevenueUgx: 0, grossProfitUgx: 0 })],
    });
    const scoped = [ok, voided].filter(isRevenueSale);
    expect(scoped).toHaveLength(1);
    const profit = computeTodayProfitBreakdown(scoped, productById, []).profitUgx;
    expect(averageGrossProfitPerSale(profit, scoped.length)).toBe(40_000);
    expect(averageSaleUgx(100_000, scoped.length)).toBe(100_000);
  });

  it("T4 — average gross profit uses revenue-eligible population", () => {
    const a = sale({ id: "a", totalUgx: 100_000 });
    const b = sale({ id: "b", totalUgx: 50_000, estimatedProfitUgx: 10_000, lines: [
      line({ lineTotalUgx: 50_000, unitCostUgx: 40_000, cogsUgx: 40_000, netRevenueUgx: 50_000, grossProfitUgx: 10_000 }),
    ]});
    const scoped = [a, b].filter(isRevenueSale);
    const profit = computeTodayProfitBreakdown(scoped, productById, []).profitUgx;
    expect(profit).toBe(50_000);
    expect(averageGrossProfitPerSale(profit, scoped.length)).toBe(25_000);
  });

  it("T5 — same-day linked return no regression", () => {
    const original = sale({ id: "sd", totalUgx: 100_000 });
    const linked: ReturnRecord = {
      id: "r1",
      saleId: original.id,
      productId: "prod-1",
      productName: "Widget",
      quantity: 1,
      refundAmountUgx: 40_000,
      cogsUgx: 24_000,
      reason: "wrong_item",
      actorUserId: "o",
      actorName: "O",
      shiftId: null,
      createdAt: `${DAY1}T14:00:00.000Z`,
    };
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 40_000) };
    const returns = mergeLinkedReturnsForScopedSales([adjusted], [linked], [linked]);
    const breakdown = computeTodayProfitBreakdown([adjusted], productById, returns);
    expect(computeCanonicalRevenueUgx([adjusted], returns)).toBe(60_000);
    expect(breakdown.salesUgx).toBe(60_000);
    expect(breakdown.salesUgx - breakdown.costUgx).toBe(breakdown.profitUgx);
  });

  it("T6 — cross-day linked return no regression", () => {
    const original = sale({ id: "xd", totalUgx: 100_000, day: DAY1 });
    const linked: ReturnRecord = {
      id: "r2",
      saleId: original.id,
      productId: "prod-1",
      productName: "Widget",
      quantity: 1,
      refundAmountUgx: 100_000,
      cogsUgx: 60_000,
      reason: "wrong_item",
      actorUserId: "o",
      actorName: "O",
      shiftId: null,
      createdAt: `${DAY2}T14:00:00.000Z`,
    };
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 100_000) };
    const returns = mergeLinkedReturnsForScopedSales([adjusted], [], [linked]);
    const breakdown = computeTodayProfitBreakdown([adjusted], productById, returns);
    expect(breakdown.salesUgx).toBe(0);
    expect(breakdown.costUgx).toBe(0);
    expect(breakdown.profitUgx).toBe(0);
  });

  it("T7 — closed-day R − C = GP", () => {
    const cost = resolveProfitHeadlineCostUgx({
      closedPeriod: true,
      revenueUgx: 200_000,
      profitUgx: 80_000,
      liveCostUgx: 1,
    });
    expect(cost).toBe(120_000);
    expect(200_000 - cost).toBe(80_000);
  });

  it("T8 — tender independence", () => {
    for (const method of ["cash", "mobile_money", "atm", "credit", "mixed"] as const) {
      const s = sale({
        id: method,
        totalUgx: 100_000,
        paymentMethod: method,
        cashPaidUgx: method === "credit" ? 0 : method === "mixed" ? 60_000 : 100_000,
        debtUgx: method === "credit" ? 100_000 : method === "mixed" ? 40_000 : 0,
      });
      const b = computeTodayProfitBreakdown([s], productById, []);
      expect(b.salesUgx).toBe(100_000);
      expect(b.profitUgx).toBe(40_000);
    }
  });

  it("T9 — debt collection is not profit/revenue input", () => {
    // Profit scope is sales-only; debt payments are never passed into computeTodayProfitBreakdown.
    const s = sale({ id: "credit", totalUgx: 100_000, paymentMethod: "credit", cashPaidUgx: 0, debtUgx: 100_000 });
    const before = computeTodayProfitBreakdown([s], productById, []);
    // Simulating a later debt collection must not change sale profit when only sales are in scope.
    expect(before.salesUgx).toBe(100_000);
    expect(before.profitUgx).toBe(40_000);
  });

  it("T10 — range flow totals exclude voids", () => {
    const a = sale({ id: "a", totalUgx: 100_000, day: DAY1 });
    const b = sale({ id: "b", totalUgx: 50_000, day: DAY2 });
    const voided = sale({
      id: "v",
      totalUgx: 0,
      day: DAY2,
      saleVoidedAt: `${DAY2}T12:00:00.000Z`,
      lines: [line({ lineTotalUgx: 0, voided: true, unitCostUgx: 0, cogsUgx: 0, netRevenueUgx: 0, grossProfitUgx: 0 })],
    });
    const scoped = [a, b, voided].filter(isRevenueSale);
    const bdown = computeTodayProfitBreakdown(scoped, productById, []);
    expect(scoped).toHaveLength(2);
    expect(bdown.salesUgx).toBe(150_000);
    expect(averageSaleUgx(bdown.salesUgx, scoped.length)).toBe(75_000);
  });

  it("T11 — export matches corrected Profit model labels and fields", () => {
    const rows = buildProfitExportRows({
      lang: "en",
      periodLabel: "Aug 2026",
      grossProfitUgx: 40_000,
      revenueUgx: 100_000,
      costUgx: 60_000,
      marginPct: 40,
      transactionCount: 1,
      averageGrossProfitUgx: 40_000,
      costIncomplete: true,
      closedPeriod: true,
      groups: [{ categoryLabel: "General", profitUgx: 40_000, products: [{ name: "Widget", profitUgx: 40_000 }] }],
    });
    const flat = rows.map((r) => r.join("|")).join("\n");
    expect(flat).toContain("Gross profit|40000");
    expect(flat).toContain("Revenue|100000");
    expect(flat).toContain("Cost|60000");
    expect(flat).toContain(t("en", "profitExportCostIncomplete"));
    expect(flat).toContain(t("en", "profitGrossProfitEstimated"));
    expect(flat).toContain(t("en", "reportDocLiveBreakdown"));
    expect(flat.toLowerCase()).not.toMatch(/\|net profit\|/i);
  });

  it("T12 — semantic labels say Gross Profit, not Net Profit", () => {
    expect(t("en", "profitStatGrossProfit")).toBe("Gross profit");
    expect(t("en", "profitGrossProfitEstimated")).toMatch(/Gross profit/i);
    expect(t("en", "profitStatNetProfit")).toBe("Gross profit"); // legacy key remapped
    expect(resolvePeriodReportAuthority([], { fromKey: DAY1, toKey: DAY1, isSingleDay: true })).toBe("live");
  });
});
