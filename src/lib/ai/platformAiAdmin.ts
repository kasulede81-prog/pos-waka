import { supabase } from "../supabase";
import { invalidatePlatformAiSettingsCache } from "./platformAiSettings";
import type { PlatformAiSettingsV2 } from "./platformAiSettings.v2";
import { settingsToAdminPayload } from "./platformAiSettings.v2";

export type AiPlatformUsageStats = {
  monthlyLimit: number;
  generationsThisMonth: number;
  cacheHitsThisMonth: number;
  totalRequestsThisMonth: number;
  cacheHitRatePct: number;
  remaining: number;
};

export type AiPlatformMetrics = {
  totals: {
    requests: number;
    successful: number;
    failed: number;
    cacheHits: number;
    cacheMisses: number;
    estimatedCostUsd: number;
    avgLatencyMs: number;
  };
  limits: {
    monthlyRequestLimit: number;
    monthlyBudgetLimit: number;
    remainingRequests: number;
    remainingBudgetUsd: number;
  };
  byFeature: Array<{ feature: string; count: number; costUsd: number }>;
  byShop: Array<{ shop_id: string; shop_name: string; count: number }>;
};

export async function adminUpdatePlatformAiSettings(
  settings: Partial<PlatformAiSettingsV2>,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_update_platform_ai_settings", {
    p_settings: settingsToAdminPayload(settings as PlatformAiSettingsV2),
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string } | null;
  if (!row?.ok) return { ok: false, error: row?.error ?? "update_failed" };
  invalidatePlatformAiSettingsCache();
  return { ok: true };
}

export async function fetchAiPlatformUsageStats(): Promise<AiPlatformUsageStats | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_ai_platform_usage_stats");
  if (error || !data) return null;
  const o = data as Record<string, unknown>;
  const num = (k: string) => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0) || 0;
  };
  return {
    monthlyLimit: num("monthly_limit"),
    generationsThisMonth: num("generations_this_month"),
    cacheHitsThisMonth: num("cache_hits_this_month"),
    totalRequestsThisMonth: num("total_requests_this_month"),
    cacheHitRatePct: num("cache_hit_rate_pct"),
    remaining: num("remaining"),
  };
}

export async function fetchAiPlatformMetrics(days = 30): Promise<AiPlatformMetrics | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_ai_platform_metrics", { p_days: days });
  if (error || !data) return null;
  const o = data as Record<string, unknown>;
  const totals = (o.totals ?? {}) as Record<string, unknown>;
  const limits = (o.limits ?? {}) as Record<string, unknown>;
  const num = (obj: Record<string, unknown>, k: string) => {
    const v = obj[k];
    return typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0) || 0;
  };

  const byFeature = Array.isArray(o.by_feature)
    ? (o.by_feature as Array<Record<string, unknown>>).map((r) => ({
        feature: String(r.feature ?? "unknown"),
        count: num(r, "count"),
        costUsd: num(r, "cost_usd"),
      }))
    : [];

  const byShop = Array.isArray(o.by_shop)
    ? (o.by_shop as Array<Record<string, unknown>>).map((r) => ({
        shop_id: String(r.shop_id ?? ""),
        shop_name: String(r.shop_name ?? ""),
        count: num(r, "count"),
      }))
    : [];

  return {
    totals: {
      requests: num(totals, "requests"),
      successful: num(totals, "successful"),
      failed: num(totals, "failed"),
      cacheHits: num(totals, "cache_hits"),
      cacheMisses: num(totals, "cache_misses"),
      estimatedCostUsd: num(totals, "estimated_cost_usd"),
      avgLatencyMs: num(totals, "avg_latency_ms"),
    },
    limits: {
      monthlyRequestLimit: num(limits, "monthly_request_limit"),
      monthlyBudgetLimit: num(limits, "monthly_budget_limit"),
      remainingRequests: num(limits, "remaining_requests"),
      remainingBudgetUsd: num(limits, "remaining_budget_usd"),
    },
    byFeature,
    byShop,
  };
}
