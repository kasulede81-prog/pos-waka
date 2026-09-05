import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, ReturnRecord, Sale, SaleLine } from "../types";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { computeTodayProfitBreakdown, mergeLinkedReturnsForScopedSales } from "./homeProfit";
import { localGetRangeSummary } from "./localReporting";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { isRevenueSale } from "./saleStatus";

const DAY1 = "2026-08-12";
const DAY2 = "2026-08-13";
const DAY3 = "2026-08-14";

const product: Product = {
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
};

function products(): Product[] {
  return [product];
}
const productById = new Map(products().map((p) => [p.id, p]));

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
    voided: false,
    lineTotalUgx: total,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx"> & { day?: string }): Sale {
  const day = partial.day ?? DAY1;
  const at = `${day}T10:00:00.000Z`;
  const total = partial.totalUgx;
  const unitCost = partial.lines?.[0]?.unitCostUgx ?? 60_000;
  const cogs = Math.round(unitCost);
  const { day: _d, createdAt: _c, updatedAt: _u, ...rest } = partial;
  return {
    status: "completed",
    subtotalUgx: total,
    cashPaidUgx: partial.cashPaidUgx ?? total,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: total - cogs,
    lines: partial.lines ?? [
      line({
        lineTotalUgx: total,
        unitCostUgx: unitCost,
        cogsUgx: cogs,
        netRevenueUgx: total,
        grossProfitUgx: total - cogs,
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

function closeDay1(profitUgx: number, salesUgx: number): DayCloseSummary {
  const createdAt = `${DAY1}T18:00:00.000Z`;
  const row = {
    id: "close-d1",
    dateKey: DAY1,
    expectedCashUgx: salesUgx,
    countedCashUgx: salesUgx,
    differenceUgx: 0,
    totalSalesUgx: salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: profitUgx,
    openingFloatUgx: 0,
    createdAt,
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
        cashFromSalesUgx: salesUgx,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 0,
        cashSalesUgx: salesUgx,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: 1,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: createdAt,
  };
}

function reportsDay(sales: Sale[], returns: ReturnRecord[], dateKey: string, dayCloses?: DayCloseSummary[]) {
  return localGetRangeSummary(sales, products(), [], returns, [], { kind: "day", dateKey }, [], dayCloses);
}

function reportsRange(sales: Sale[], returns: ReturnRecord[], fromKey: string, toKey: string) {
  return localGetRangeSummary(sales, products(), [], returns, [], { kind: "range", fromKey, toKey }, []);
}

function profitPageForDay(sales: Sale[], dateReturns: ReturnRecord[], allReturns: ReturnRecord[]) {
  const scoped = sales.filter(isRevenueSale);
  const profitReturns = mergeLinkedReturnsForScopedSales(scoped, dateReturns, allReturns);
  return computeTodayProfitBreakdown(scoped, productById, profitReturns);
}

describe("RPT-P1-02 Reports KPI profit merges later-day linked returns", () => {
  it("TEST 1 — later-day full linked return zeros Day 1 profit", () => {
    const original = sale({ id: "s1", totalUgx: 100_000 });
    const linked = ret({ id: "r1", saleId: original.id, refundAmountUgx: 100_000, day: DAY2, cogsUgx: 60_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 100_000) };
    const range = reportsDay([adjusted], [linked], DAY1);
    expect(range.summary.totalRevenueUgx).toBe(0);
    expect(range.profitUgx).toBe(0);
    const page = profitPageForDay([adjusted], [], [linked]);
    expect(page.salesUgx).toBe(0);
    expect(page.costUgx).toBe(0);
    expect(page.profitUgx).toBe(0);
  });

  it("TEST 2 — later-day partial linked return follows existing helper", () => {
    const original = sale({ id: "s1", totalUgx: 100_000 });
    const linked = ret({ id: "r-part", saleId: original.id, refundAmountUgx: 40_000, day: DAY2, cogsUgx: 24_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 40_000) };
    const expected = profitPageForDay([adjusted], [], [linked]);
    const range = reportsDay([adjusted], [linked], DAY1);
    expect(range.summary.totalRevenueUgx).toBe(expected.salesUgx);
    expect(range.profitUgx).toBe(expected.profitUgx);
    expect(expected.salesUgx).toBe(60_000);
    expect(expected.costUgx).toBe(36_000);
    expect(expected.profitUgx).toBe(24_000);
  });

  it("TEST 3 — same-day linked return remains unchanged", () => {
    const original = sale({ id: "s1", totalUgx: 100_000 });
    const linked = ret({ id: "r-same", saleId: original.id, refundAmountUgx: 40_000, day: DAY1, cogsUgx: 24_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 40_000) };
    const range = reportsDay([adjusted], [linked], DAY1);
    expect(range.summary.totalRevenueUgx).toBe(60_000);
    expect(range.profitUgx).toBe(24_000);
  });

  it("TEST 4 — no return keeps ordinary profit", () => {
    const s = sale({ id: "ok", totalUgx: 100_000 });
    const range = reportsDay([s], [], DAY1);
    expect(range.summary.totalRevenueUgx).toBe(100_000);
    expect(range.profitUgx).toBe(40_000);
  });

  it("TEST 5 — unlinked later return does not reverse an arbitrary Day 1 sale", () => {
    const s = sale({ id: "ok", totalUgx: 100_000 });
    const unlinked = ret({ id: "r-out", saleId: "", refundAmountUgx: 100_000, day: DAY2, cogsUgx: 60_000 });
    const range = reportsDay([s], [unlinked], DAY1);
    expect(range.summary.totalRevenueUgx).toBe(100_000);
    expect(range.profitUgx).toBe(40_000);
  });

  it("TEST 6 — range Day 1–2 includes Day 2 sale and reverses Day 1 via Day 3 linked return", () => {
    const original = sale({ id: "s1", totalUgx: 100_000, day: DAY1 });
    const day2 = sale({
      id: "s2",
      totalUgx: 50_000,
      day: DAY2,
      lines: [
        line({
          lineTotalUgx: 50_000,
          unitCostUgx: 20_000,
          cogsUgx: 20_000,
          netRevenueUgx: 50_000,
          grossProfitUgx: 30_000,
        }),
      ],
    });
    const linked = ret({ id: "r-d3", saleId: original.id, refundAmountUgx: 100_000, day: DAY3, cogsUgx: 60_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 100_000) };
    const range = reportsRange([adjusted, day2], [linked], DAY1, DAY2);
    expect(range.summary.totalRevenueUgx).toBe(50_000);
    expect(range.profitUgx).toBe(30_000);
  });

  it("TEST 7 — closed-day frozen profit is not replaced by live recalculation", () => {
    const original = sale({ id: "s1", totalUgx: 100_000 });
    const linked = ret({ id: "r-late", saleId: original.id, refundAmountUgx: 100_000, day: DAY2, cogsUgx: 60_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 100_000) };
    const close = closeDay1(40_000, 100_000);
    const range = reportsDay([adjusted], [linked], DAY1, [close]);
    expect(range.authority).toBe("closed_snapshot");
    expect(range.profitUgx).toBe(40_000);
    expect(range.summary.totalRevenueUgx).toBe(100_000);
  });

  it("TEST 8 — open Day 1 Reports profit matches ProfitPage merge", () => {
    const original = sale({ id: "s1", totalUgx: 100_000 });
    const linked = ret({ id: "r1", saleId: original.id, refundAmountUgx: 100_000, day: DAY2, cogsUgx: 60_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 100_000) };
    const range = reportsDay([adjusted], [linked], DAY1);
    const page = profitPageForDay([adjusted], [], [linked]);
    expect(range.profitUgx).toBe(page.profitUgx);
    expect(range.summary.totalRevenueUgx).toBe(page.salesUgx);
  });
});
