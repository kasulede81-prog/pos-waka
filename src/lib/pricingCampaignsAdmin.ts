/**
 * Data access for the Pricing Campaigns window.
 *
 * Domain types, status derivation and validation live in `pricingCampaigns.ts`
 * (pure, unit-tested); this module owns the RPC/table calls and re-exports the
 * types so existing importers keep working.
 *
 * Reads return a discriminated result instead of collapsing every failure into
 * an empty array — a denied or failed load used to render identically to
 * “no campaigns yet”, which hid real outages from the operator.
 */
import { supabase } from "./supabase";
import {
  buildDefaultPublicPricing,
  mapPublicPricingRpc,
  type MonthlyDiscountType,
  type PaidPlanCode,
  type PublicPricingSnapshot,
} from "./subscriptionPricing";
import { mapPricingCampaignError } from "./pricingCampaigns";
import type {
  PricingCampaign,
  PricingCampaignAuditEntry,
  PricingCampaignMetrics,
  PricingCampaignPlanDiscount,
} from "./pricingCampaigns";

export type {
  PricingCampaign,
  PricingCampaignAuditEntry,
  PricingCampaignMetrics,
  PricingCampaignPlanDiscount,
} from "./pricingCampaigns";

export type PricingFetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

type RpcResult = { ok: boolean; error?: string };

function rpcResult(data: unknown, error: { message: string } | null): RpcResult {
  if (error) return { ok: false, error: mapPricingCampaignError(error.message) };
  const obj = (data ?? {}) as Record<string, unknown>;
  if (obj.ok === false) return { ok: false, error: mapPricingCampaignError(String(obj.error ?? "")) };
  return { ok: true };
}

type CampaignRow = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

type DiscountRow = {
  id: string;
  campaign_id: string;
  plan_code: string;
  monthly_discount_type: string;
  monthly_discount_value: number;
  annual_discount_percent: number | null;
};

function mapCampaign(row: CampaignRow): PricingCampaign {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDiscount(row: DiscountRow): PricingCampaignPlanDiscount {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    planCode: row.plan_code as PaidPlanCode,
    monthlyDiscountType: row.monthly_discount_type as MonthlyDiscountType,
    monthlyDiscountValue: Number(row.monthly_discount_value),
    annualDiscountPercent: row.annual_discount_percent,
  };
}

/** Public marketing/upgrade price book. Falls back to canonical prices. */
export async function fetchPublicSubscriptionPricing(): Promise<PublicPricingSnapshot> {
  if (!supabase) return buildDefaultPublicPricing();
  const { data, error } = await supabase.rpc("public_subscription_pricing");
  if (error || !data) return buildDefaultPublicPricing();
  return mapPublicPricingRpc(data);
}

export async function fetchPricingCampaigns(): Promise<PricingFetchResult<PricingCampaign[]>> {
  if (!supabase) return { ok: false, error: "Supabase is not configured for this build." };
  const { data, error } = await supabase
    .from("pricing_campaigns")
    .select("id, name, description, enabled, starts_at, ends_at, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return { ok: false, error: mapPricingCampaignError(error.message) };
  return { ok: true, data: ((data ?? []) as CampaignRow[]).map(mapCampaign) };
}

/** Batch read — the window lists every campaign's pricing rule in one query. */
export async function fetchPricingCampaignDiscounts(
  campaignIds: readonly string[],
): Promise<PricingFetchResult<PricingCampaignPlanDiscount[]>> {
  if (!supabase) return { ok: false, error: "Supabase is not configured for this build." };
  if (campaignIds.length === 0) return { ok: true, data: [] };
  const { data, error } = await supabase
    .from("pricing_campaign_plan_discounts")
    .select("id, campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent")
    .in("campaign_id", campaignIds);
  if (error) return { ok: false, error: mapPricingCampaignError(error.message) };
  return { ok: true, data: ((data ?? []) as DiscountRow[]).map(mapDiscount) };
}

export async function savePricingCampaign(campaign: {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
}): Promise<RpcResult & { campaignId?: string }> {
  if (!supabase) return { ok: false, error: "Supabase is not configured for this build." };
  const { data, error } = await supabase.rpc("admin_pricing_campaign_save", {
    p_id: campaign.id,
    p_name: campaign.name,
    p_description: campaign.description,
    p_enabled: campaign.enabled,
    p_starts_at: campaign.startsAt,
    p_ends_at: campaign.endsAt,
  });
  const res = rpcResult(data, error);
  const campaignId = (data as Record<string, unknown> | null)?.campaign_id;
  return { ...res, campaignId: typeof campaignId === "string" ? campaignId : undefined };
}

export async function savePricingCampaignPlanDiscount(input: {
  campaignId: string;
  planCode: PaidPlanCode;
  monthlyDiscountType: MonthlyDiscountType;
  monthlyDiscountValue: number;
  annualDiscountPercent: number | null;
  reason: string;
}): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "Supabase is not configured for this build." };
  const { data, error } = await supabase.rpc("admin_pricing_campaign_plan_discount_save", {
    p_campaign_id: input.campaignId,
    p_plan_code: input.planCode,
    p_monthly_discount_type: input.monthlyDiscountType,
    p_monthly_discount_value: input.monthlyDiscountValue,
    p_annual_discount_percent: input.annualDiscountPercent,
    p_reason: input.reason,
  });
  return rpcResult(data, error);
}

export async function fetchPricingCampaignMetrics(opts: {
  campaignId: string;
}): Promise<PricingFetchResult<PricingCampaignMetrics>> {
  if (!supabase) return { ok: false, error: "Supabase is not configured for this build." };
  const { data, error } = await supabase.rpc("admin_pricing_campaign_metrics", {
    p_campaign_id: opts.campaignId,
    p_from: null,
    p_to: null,
  });
  if (error) return { ok: false, error: mapPricingCampaignError(error.message) };
  if (!data || typeof data !== "object") return { ok: false, error: "Campaign reporting returned no data." };
  const obj = data as Record<string, unknown>;
  return {
    ok: true,
    data: {
      campaignId: typeof obj.campaign_id === "string" ? obj.campaign_id : null,
      campaignName: typeof obj.campaign_name === "string" ? obj.campaign_name : null,
      campaignActive: Boolean(obj.campaign_active),
      newSubscribers: Number(obj.new_subscribers ?? 0),
      newSubscribersByPlan: (obj.new_subscribers_by_plan as Record<string, number>) ?? {},
      revenueRecordedUgx: Number(obj.revenue_recorded_ugx ?? 0),
      conversionRatePercent: Number(obj.conversion_rate_percent ?? 0),
      totalSubscriptionsInWindow: Number(obj.total_subscriptions_in_window ?? 0),
    },
  };
}

export async function fetchPricingCampaignAuditFeed(
  limit = 50,
): Promise<PricingFetchResult<PricingCampaignAuditEntry[]>> {
  if (!supabase) return { ok: false, error: "Supabase is not configured for this build." };
  const { data, error } = await supabase.rpc("admin_pricing_campaign_audit_feed", { p_limit: limit });
  if (error) return { ok: false, error: mapPricingCampaignError(error.message) };
  const rows = Array.isArray(data) ? data : [];
  return {
    ok: true,
    data: rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        campaignId: typeof r.campaign_id === "string" ? r.campaign_id : null,
        planCode: typeof r.plan_code === "string" ? (r.plan_code as PaidPlanCode) : null,
        actorName: String(r.actor_name ?? ""),
        previousDiscount: (r.previous_discount as Record<string, unknown>) ?? {},
        newDiscount: (r.new_discount as Record<string, unknown>) ?? {},
        reason: String(r.reason ?? ""),
        createdAt: String(r.created_at ?? ""),
      };
    }),
  };
}
