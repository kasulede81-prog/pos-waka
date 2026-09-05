import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import { MONTH_TO_DATE_FILTER, resolveDateFilterBounds, saleMatchesFilter } from "./dateFilters";
import { computeTodayProfitBreakdown, mergeLinkedReturnsForScopedSales } from "./homeProfit";
import { resolveProfitPageDateAuthority } from "./profitPageDateAuthority";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { isRevenueSale } from "./saleStatus";
import { resolveProfitVisibility } from "./profitVisibility";

const DAY1 = "2026-08-12";
const DAY2 = "2026-08-13";

const localDefault = MONTH_TO_DATE_FILTER;

function line(total: number, unitCost = 6_000): SaleLine {
  return {
    productId: "prod-1",
    name: "Widget",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: unitCost,
    cogsUgx: unitCost,
    netRevenueUgx: total,
    grossProfitUgx: total - unitCost,
    estimatedProfitUgx: total - unitCost,
    inputMode: "quantity",
    voided: false,
    lineTotalUgx: total,
  };
}

function sale(id: string, totalUgx: number, day: string): Sale {
  const at = `${day}T10:00:00.000Z`;
  return {
    id,
    createdAt: at,
    updatedAt: at,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: totalUgx - 6_000,
    lines: [line(totalUgx)],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
  };
}

const product: Product = {
  id: "prod-1",
  name: "Widget",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 6_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${DAY1}T09:00:00.000Z`,
  version: 1,
};

describe("RPT-P2-06 ProfitPage date authority", () => {
  it("TEST 1 — embedded initial Yesterday is not standalone MTD", () => {
    const yesterday = { kind: "preset" as const, preset: "yesterday" as const };
    const resolved = resolveProfitPageDateAuthority({
      controlledFilter: yesterday,
      localFilter: localDefault,
    });
    expect(resolved.controlled).toBe(true);
    expect(resolved.filter).toEqual(yesterday);
    expect(resolved.filter).not.toEqual(localDefault);
    expect(resolved.bounds).toEqual(resolveDateFilterBounds(yesterday));
  });

  it("TEST 2 — embedded range change from This month to Yesterday updates authority", () => {
    const start = resolveProfitPageDateAuthority({
      controlledFilter: { kind: "preset", preset: "this_month" },
      localFilter: localDefault,
    });
    expect(start.filter).toEqual({ kind: "preset", preset: "this_month" });

    const next = resolveProfitPageDateAuthority({
      controlledFilter: { kind: "preset", preset: "yesterday" },
      localFilter: localDefault,
    });
    expect(next.filter).toEqual({ kind: "preset", preset: "yesterday" });
    expect(next.bounds).toEqual(resolveDateFilterBounds({ kind: "preset", preset: "yesterday" }));
  });

  it("TEST 3 — Today", () => {
    const filter = { kind: "preset" as const, preset: "today" as const };
    const resolved = resolveProfitPageDateAuthority({ controlledFilter: filter, localFilter: localDefault });
    expect(resolved.filter).toEqual(filter);
    expect(resolved.bounds).toEqual(resolveDateFilterBounds(filter));
  });

  it("TEST 4 — This week", () => {
    const filter = { kind: "preset" as const, preset: "this_week" as const };
    const resolved = resolveProfitPageDateAuthority({ controlledFilter: filter, localFilter: localDefault });
    expect(resolved.filter).toEqual(filter);
    expect(resolved.bounds).toEqual(resolveDateFilterBounds(filter));
  });

  it("TEST 5 — This month", () => {
    const filter = { kind: "preset" as const, preset: "this_month" as const };
    const resolved = resolveProfitPageDateAuthority({ controlledFilter: filter, localFilter: localDefault });
    expect(resolved.filter).toEqual(filter);
    expect(resolved.bounds).toEqual(resolveDateFilterBounds(filter));
  });

  it("TEST 6 — custom range uses the exact start/end", () => {
    const filter = { kind: "range" as const, fromKey: "2026-07-01", toKey: "2026-07-15" };
    const resolved = resolveProfitPageDateAuthority({ controlledFilter: filter, localFilter: localDefault });
    expect(resolved.filter).toEqual(filter);
    expect(resolved.bounds).toEqual({ fromKey: "2026-07-01", toKey: "2026-07-15", isSingleDay: false });
  });

  it("TEST 7 — standalone without parent range keeps ProfitPage local filter", () => {
    const localFilter = { kind: "preset" as const, preset: "this_week" as const };
    const resolved = resolveProfitPageDateAuthority({
      controlledFilter: null,
      localFilter,
    });
    expect(resolved.controlled).toBe(false);
    expect(resolved.filter).toEqual(localFilter);
    expect(resolved.bounds).toEqual(resolveDateFilterBounds(localFilter));

    const mtd = resolveProfitPageDateAuthority({ localFilter: MONTH_TO_DATE_FILTER });
    expect(mtd.controlled).toBe(false);
    expect(mtd.filter).toEqual(MONTH_TO_DATE_FILTER);
  });

  it("TEST 8 — embedded later-day linked return uses the shell range and P1-02 merge", () => {
    const shell = { kind: "day" as const, dateKey: DAY1 };
    const { bounds } = resolveProfitPageDateAuthority({
      controlledFilter: shell,
      localFilter: localDefault,
    });
    const original = sale("s1", 10_000, DAY1);
    const linked: ReturnRecord = {
      id: "r1",
      saleId: original.id,
      productId: "prod-1",
      productName: "Widget",
      quantity: 1,
      reason: "wrong_item",
      actorUserId: "owner",
      actorName: "Owner",
      shiftId: null,
      createdAt: `${DAY2}T14:00:00.000Z`,
      refundAmountUgx: 10_000,
      cogsUgx: 6_000,
    };
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 10_000) };
    const scoped = [adjusted].filter((s) => isRevenueSale(s) && saleMatchesFilter(s, bounds));
    expect(scoped).toHaveLength(1);
    const profitReturns = mergeLinkedReturnsForScopedSales(scoped, [], [linked]);
    const page = computeTodayProfitBreakdown(scoped, new Map([[product.id, product]]), profitReturns);
    expect(page.salesUgx).toBe(0);
    expect(page.profitUgx).toBe(0);
  });

  it("TEST 9 — shell closed day is the exact ProfitPage date", () => {
    const closed = { kind: "day" as const, dateKey: DAY1 };
    const resolved = resolveProfitPageDateAuthority({
      controlledFilter: closed,
      localFilter: MONTH_TO_DATE_FILTER,
    });
    expect(resolved.filter).toEqual(closed);
    expect(resolved.bounds.fromKey).toBe(DAY1);
    expect(resolved.bounds.toKey).toBe(DAY1);
    expect(resolved.bounds.isSingleDay).toBe(true);
  });

  it("TEST 10 — reports.profit permission is unchanged", () => {
    const denied = resolveProfitVisibility({
      role: "cashier",
      snapshot: { kind: "local_full" },
      authMode: "local",
    });
    expect(denied.canProfit).toBe(false);

    const allowed = resolveProfitVisibility({
      role: "owner",
      snapshot: { kind: "local_full" },
      authMode: "local",
    });
    expect(allowed.canProfit).toBe(true);
  });
});
