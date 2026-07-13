import type { Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { scanTodaySalesHead } from "./salesDayIndex";
import { readKv, writeKv } from "../offline/localDb";
import { getActiveAccountKey } from "../offline/accountScope";

export type TodayKpiSnapshot = {
  dayKey: string;
  transactionCount: number;
  totalRevenueUgx: number;
  updatedAt: string;
};

const KV_SUFFIX = "today-kpi-v1";

function kvKey(): string | null {
  const accountKey = getActiveAccountKey();
  if (!accountKey || accountKey.startsWith("demo:")) return null;
  return `${accountKey}::${KV_SUFFIX}`;
}

export async function readTodayKpiSnapshot(): Promise<TodayKpiSnapshot | null> {
  const key = kvKey();
  if (!key) return null;
  const row = await readKv<TodayKpiSnapshot>(key);
  if (!row?.dayKey) return null;
  return row;
}

export async function writeTodayKpiSnapshot(snapshot: TodayKpiSnapshot): Promise<void> {
  const key = kvKey();
  if (!key) return;
  await writeKv(key, snapshot);
}

export function buildTodayKpiSnapshotFromSales(
  sales: Sale[],
  todayKey = dateKeyKampala(new Date()),
): TodayKpiSnapshot {
  const { todaySales } = scanTodaySalesHead(sales, todayKey);
  const totalRevenueUgx = todaySales.reduce((sum, s) => sum + s.totalUgx, 0);
  return {
    dayKey: todayKey,
    transactionCount: todaySales.length,
    totalRevenueUgx,
    updatedAt: new Date().toISOString(),
  };
}

/** Apply a completed sale to the in-memory snapshot (same Kampala day only). */
export function bumpTodayKpiSnapshot(
  current: TodayKpiSnapshot | null,
  sale: Sale,
  todayKey = dateKeyKampala(new Date()),
): TodayKpiSnapshot {
  if (sale.status === "pending" || sale.status === "cancelled") {
    return current ?? buildTodayKpiSnapshotFromSales([], todayKey);
  }
  if (dateKeyKampala(sale.createdAt) !== todayKey) {
    return buildTodayKpiSnapshotFromSales([sale], todayKey);
  }
  const base =
    current?.dayKey === todayKey
      ? current
      : { dayKey: todayKey, transactionCount: 0, totalRevenueUgx: 0, updatedAt: new Date().toISOString() };
  return {
    dayKey: todayKey,
    transactionCount: base.transactionCount + 1,
    totalRevenueUgx: base.totalRevenueUgx + sale.totalUgx,
    updatedAt: new Date().toISOString(),
  };
}

/** Prefer cached snapshot during background sales hydration to avoid KPI climb. */
export function resolveStableTodayKpi(
  snapshot: TodayKpiSnapshot | null,
  computed: { transactionCount: number; totalRevenueUgx: number },
  todayKey: string,
  salesHydrating: boolean,
): { transactionCount: number; totalRevenueUgx: number } {
  if (!salesHydrating || !snapshot || snapshot.dayKey !== todayKey) {
    return computed;
  }
  return {
    transactionCount: Math.max(snapshot.transactionCount, computed.transactionCount),
    totalRevenueUgx: Math.max(snapshot.totalRevenueUgx, computed.totalRevenueUgx),
  };
}
