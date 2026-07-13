import { describe, expect, it } from "vitest";
import type { Sale } from "../types";
import {
  buildTodayKpiSnapshotFromSales,
  bumpTodayKpiSnapshot,
  resolveStableTodayKpi,
} from "./todayKpiSnapshot";

function mkSale(id: string, totalUgx: number, createdAt = "2026-07-12T10:00:00.000Z"): Sale {
  return {
    id,
    status: "completed",
    createdAt,
    updatedAt: createdAt,
    lines: [],
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    pendingSync: false,
  };
}

describe("todayKpiSnapshot", () => {
  const todayKey = "2026-07-12";

  it("builds snapshot from today sales head", () => {
    const snap = buildTodayKpiSnapshotFromSales(
      [
        mkSale("a", 5_000),
        mkSale("b", 3_000),
        mkSale("old", 9_000, "2026-07-10T10:00:00.000Z"),
      ],
      todayKey,
    );
    expect(snap.transactionCount).toBe(2);
    expect(snap.totalRevenueUgx).toBe(8_000);
    expect(snap.dayKey).toBe(todayKey);
  });

  it("bumps snapshot on new sale", () => {
    const base = buildTodayKpiSnapshotFromSales([mkSale("a", 1_000)], todayKey);
    const next = bumpTodayKpiSnapshot(base, mkSale("b", 2_000), todayKey);
    expect(next.transactionCount).toBe(2);
    expect(next.totalRevenueUgx).toBe(3_000);
  });

  it("keeps stable KPIs during background hydration", () => {
    const snapshot = buildTodayKpiSnapshotFromSales([mkSale("a", 10_000), mkSale("b", 5_000)], todayKey);
    const stable = resolveStableTodayKpi(
      snapshot,
      { transactionCount: 1, totalRevenueUgx: 5_000 },
      todayKey,
      true,
    );
    expect(stable.transactionCount).toBe(2);
    expect(stable.totalRevenueUgx).toBe(15_000);
  });
});
