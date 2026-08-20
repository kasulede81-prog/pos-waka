import { getDeviceOnline } from "./deviceOnline";
import { hasSupabaseConfig, supabase } from "./supabase";

/** Local Home totals before the shop-wide overlay is applied. */
export type HomeLocalKpiNumbers = {
  todayTransactionCount: number;
  todayRevenueUgx: number;
  todayExpectedCashUgx: number;
  monthRevenueUgx: number;
  monthProfitUgx: number;
  previousMonthRevenueUgx: number;
  revenueGrowthPct: number | null;
};

/** Shop-authoritative Home KPIs from `shop_get_*_sales_summary`. Missing fields stay local. */
export type HomeShopKpiOverlay = {
  todayKey: string;
  monthKey: string;
  todayTransactionCount: number | null;
  todayRevenueUgx: number | null;
  todayExpectedCashUgx: number | null;
  monthRevenueUgx: number | null;
  monthProfitUgx: number | null;
  previousMonthRevenueUgx: number | null;
  revenueGrowthPct: number | null;
};

function parseNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

/**
 * Prefer this device when it is ahead of the shop book (unsynced local sales).
 * Otherwise use the shop book so a thin replica cannot hide sales from another device.
 */
export function pickShopOrLocalAhead(
  local: { count: number; revenue: number },
  shop: { count: number; revenue: number },
): { count: number; revenue: number } {
  if (local.revenue > shop.revenue || local.count > shop.count) return local;
  return shop;
}

export function mergeHomeKpisWithShopOverlay(
  local: HomeLocalKpiNumbers,
  overlay: HomeShopKpiOverlay | null,
  opts: { todayKey: string; monthKey: string; freezeToday: boolean },
): HomeLocalKpiNumbers {
  if (!overlay) return local;

  let todayTransactionCount = local.todayTransactionCount;
  let todayRevenueUgx = local.todayRevenueUgx;
  let todayExpectedCashUgx = local.todayExpectedCashUgx;

  if (
    !opts.freezeToday &&
    overlay.todayKey === opts.todayKey &&
    overlay.todayTransactionCount != null &&
    overlay.todayRevenueUgx != null
  ) {
    const picked = pickShopOrLocalAhead(
      { count: local.todayTransactionCount, revenue: local.todayRevenueUgx },
      { count: overlay.todayTransactionCount, revenue: overlay.todayRevenueUgx },
    );
    todayTransactionCount = picked.count;
    todayRevenueUgx = picked.revenue;
    const usedShopToday =
      picked.count === overlay.todayTransactionCount && picked.revenue === overlay.todayRevenueUgx;
    if (
      usedShopToday &&
      overlay.todayExpectedCashUgx != null &&
      local.todayExpectedCashUgx <= overlay.todayExpectedCashUgx
    ) {
      todayExpectedCashUgx = overlay.todayExpectedCashUgx;
    }
  }

  let monthRevenueUgx = local.monthRevenueUgx;
  let monthProfitUgx = local.monthProfitUgx;
  let previousMonthRevenueUgx = local.previousMonthRevenueUgx;
  let revenueGrowthPct = local.revenueGrowthPct;

  if (overlay.monthKey === opts.monthKey && overlay.monthRevenueUgx != null) {
    monthRevenueUgx = overlay.monthRevenueUgx;
    previousMonthRevenueUgx = overlay.previousMonthRevenueUgx ?? local.previousMonthRevenueUgx;
    revenueGrowthPct =
      overlay.revenueGrowthPct !== undefined && overlay.revenueGrowthPct !== null
        ? overlay.revenueGrowthPct
        : local.revenueGrowthPct;
    if (overlay.monthProfitUgx != null) {
      monthProfitUgx = overlay.monthProfitUgx;
    }
  }

  return {
    todayTransactionCount,
    todayRevenueUgx,
    todayExpectedCashUgx,
    monthRevenueUgx,
    monthProfitUgx,
    previousMonthRevenueUgx,
    revenueGrowthPct,
  };
}

export async function fetchShopHomeKpiOverlay(
  todayKey: string,
  monthKey: string,
): Promise<HomeShopKpiOverlay | null> {
  if (!supabase || !hasSupabaseConfig || !getDeviceOnline()) return null;

  let dailyRes: { data: unknown; error: { message?: string } | null };
  let monthlyRes: { data: unknown; error: { message?: string } | null };
  try {
    [dailyRes, monthlyRes] = await Promise.all([
      supabase.rpc("shop_get_daily_sales_summary", { p_day: todayKey }),
      supabase.rpc("shop_get_monthly_sales_summary", { p_month: monthKey }),
    ]);
  } catch {
    return null;
  }

  const daily = !dailyRes.error ? asRecord(dailyRes.data) : null;
  const monthly = !monthlyRes.error ? asRecord(monthlyRes.data) : null;
  const dailyOk = daily?.ok === true;
  const monthlyOk = monthly?.ok === true;
  if (!dailyOk && !monthlyOk) return null;

  const profitGated = monthly?.profit_gated === true || daily?.profit_gated === true;

  return {
    todayKey,
    monthKey,
    todayTransactionCount: dailyOk ? parseNumber(daily?.transaction_count) : null,
    todayRevenueUgx: dailyOk ? parseNumber(daily?.total_revenue_ugx) : null,
    todayExpectedCashUgx: dailyOk
      ? (parseNumber(daily?.expected_cash_in_drawer_ugx) ?? parseNumber(daily?.cash_collected_ugx))
      : null,
    monthRevenueUgx: monthlyOk ? parseNumber(monthly?.total_revenue_ugx) : null,
    monthProfitUgx: monthlyOk && !profitGated ? parseNumber(monthly?.estimated_profit_ugx) : null,
    previousMonthRevenueUgx: monthlyOk ? parseNumber(monthly?.previous_month_revenue_ugx) : null,
    revenueGrowthPct: monthlyOk ? parseNumber(monthly?.revenue_growth_pct) : null,
  };
}
