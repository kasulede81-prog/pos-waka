import { describe, expect, it } from "vitest";
import {
  mergeHomeKpisWithShopOverlay,
  pickShopOrLocalAhead,
  type HomeLocalKpiNumbers,
  type HomeShopKpiOverlay,
} from "./homeShopKpiOverlay";

const TODAY = "2026-08-20";
const MONTH = "2026-08";

function local(partial: Partial<HomeLocalKpiNumbers> = {}): HomeLocalKpiNumbers {
  return {
    todayTransactionCount: 0,
    todayRevenueUgx: 0,
    todayExpectedCashUgx: 0,
    monthRevenueUgx: 0,
    monthProfitUgx: 0,
    previousMonthRevenueUgx: 0,
    revenueGrowthPct: null,
    ...partial,
  };
}

function overlay(partial: Partial<HomeShopKpiOverlay> = {}): HomeShopKpiOverlay {
  return {
    todayKey: TODAY,
    monthKey: MONTH,
    todayTransactionCount: null,
    todayRevenueUgx: null,
    todayExpectedCashUgx: null,
    monthRevenueUgx: null,
    monthProfitUgx: null,
    previousMonthRevenueUgx: null,
    revenueGrowthPct: null,
    ...partial,
  };
}

describe("pickShopOrLocalAhead", () => {
  it("keeps this device when it has unsynced sales", () => {
    expect(
      pickShopOrLocalAhead({ count: 4, revenue: 18_000 }, { count: 3, revenue: 13_000 }),
    ).toEqual({ count: 4, revenue: 18_000 });
  });

  it("uses the shop book when the local replica is behind", () => {
    expect(
      pickShopOrLocalAhead({ count: 0, revenue: 0 }, { count: 3, revenue: 13_000 }),
    ).toEqual({ count: 3, revenue: 13_000 });
  });
});

describe("mergeHomeKpisWithShopOverlay", () => {
  it("leaves local numbers unchanged when overlay is missing", () => {
    const src = local({ todayRevenueUgx: 5_000, monthProfitUgx: 2_700 });
    expect(mergeHomeKpisWithShopOverlay(src, null, { todayKey: TODAY, monthKey: MONTH, freezeToday: false })).toEqual(
      src,
    );
  });

  it("aligns a thin desktop replica with shop today + month totals", () => {
    const merged = mergeHomeKpisWithShopOverlay(
      local({ monthRevenueUgx: 672_000, monthProfitUgx: 215_701 }),
      overlay({
        todayTransactionCount: 3,
        todayRevenueUgx: 13_000,
        todayExpectedCashUgx: 9_000,
        monthRevenueUgx: 685_000,
        monthProfitUgx: 218_401,
        previousMonthRevenueUgx: 400_000,
        revenueGrowthPct: 71.25,
      }),
      { todayKey: TODAY, monthKey: MONTH, freezeToday: false },
    );
    expect(merged.todayTransactionCount).toBe(3);
    expect(merged.todayRevenueUgx).toBe(13_000);
    expect(merged.todayExpectedCashUgx).toBe(9_000);
    expect(merged.monthRevenueUgx).toBe(685_000);
    expect(merged.monthProfitUgx).toBe(218_401);
    expect(merged.revenueGrowthPct).toBe(71.25);
  });

  it("does not hide a sale that has not uploaded yet", () => {
    const merged = mergeHomeKpisWithShopOverlay(
      local({ todayTransactionCount: 3, todayRevenueUgx: 13_000, todayExpectedCashUgx: 9_000 }),
      overlay({ todayTransactionCount: 0, todayRevenueUgx: 0, todayExpectedCashUgx: 0 }),
      { todayKey: TODAY, monthKey: MONTH, freezeToday: false },
    );
    expect(merged.todayTransactionCount).toBe(3);
    expect(merged.todayRevenueUgx).toBe(13_000);
    expect(merged.todayExpectedCashUgx).toBe(9_000);
  });

  it("keeps closed-day today totals frozen", () => {
    const merged = mergeHomeKpisWithShopOverlay(
      local({ todayTransactionCount: 10, todayRevenueUgx: 50_000, todayExpectedCashUgx: 40_000 }),
      overlay({ todayTransactionCount: 12, todayRevenueUgx: 60_000, todayExpectedCashUgx: 45_000 }),
      { todayKey: TODAY, monthKey: MONTH, freezeToday: true },
    );
    expect(merged.todayTransactionCount).toBe(10);
    expect(merged.todayRevenueUgx).toBe(50_000);
    expect(merged.todayExpectedCashUgx).toBe(40_000);
  });

  it("does not apply an overlay from a different Kampala day", () => {
    const merged = mergeHomeKpisWithShopOverlay(
      local({ todayRevenueUgx: 0 }),
      overlay({ todayKey: "2026-08-19", todayTransactionCount: 3, todayRevenueUgx: 13_000 }),
      { todayKey: TODAY, monthKey: MONTH, freezeToday: false },
    );
    expect(merged.todayRevenueUgx).toBe(0);
  });

  it("does not overlay cash when this device still has unsynced sales", () => {
    const merged = mergeHomeKpisWithShopOverlay(
      local({ todayTransactionCount: 4, todayRevenueUgx: 18_000, todayExpectedCashUgx: 12_000 }),
      overlay({
        todayTransactionCount: 3,
        todayRevenueUgx: 13_000,
        todayExpectedCashUgx: 40_000,
      }),
      { todayKey: TODAY, monthKey: MONTH, freezeToday: false },
    );
    expect(merged.todayExpectedCashUgx).toBe(12_000);
  });

  it("keeps local expected cash when it includes opening float above shop cash", () => {
    const merged = mergeHomeKpisWithShopOverlay(
      local({ todayExpectedCashUgx: 59_000, todayTransactionCount: 3, todayRevenueUgx: 13_000 }),
      overlay({
        todayTransactionCount: 3,
        todayRevenueUgx: 13_000,
        todayExpectedCashUgx: 9_000,
      }),
      { todayKey: TODAY, monthKey: MONTH, freezeToday: false },
    );
    expect(merged.todayExpectedCashUgx).toBe(59_000);
  });
});
