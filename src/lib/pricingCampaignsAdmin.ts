import { supabase } from "./supabase";
import {
  buildDefaultPublicPricing,
  mapPublicPricingRpc,
  type MonthlyDiscountType,
  type PaidPlanCode,
  type PublicPricingSnapshot,
} from "./subscriptionPricing";

type RpcResult = { ok: boolean; error?: string };

function rpcResult(data: unknown, error: { message: string } | null): RpcResult {
  if (error) return { ok: false, error: error.message };
  const obj = (data ?? {}) as Record<string, unknown>;
  if (obj.ok === false) return { ok: false, error: String(obj.error ?? "failed") };
  return { ok: true };
}

export type PricingCampaign = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PricingCampaignPlanDiscount = {
  id: string;
  campaignId: string;
  planCode: PaidPlanCode;
  monthlyDiscountType: MonthlyDiscountType;
  monthlyDiscountValue: number;
  annualDiscountPercent: number | null;
};

export type PricingCampaignAuditEntry = {
  id: string;
  campaignId: string | null;
  planCode: PaidPlanCode | null;
  actorName: string;
  previousDiscount: Record<string, unknown>;
  newDiscount: Record<string, unknown>;
  reason: string;
  createdAt: string;
};

export type PricingCampaignMetrics = {
  campaignId: string | null;
  campaignName: string | null;
  campaignActive: boolean;
  newSubscribers: number;
  newSubscribersByPlan: Record<string, number>;
  revenueRecordedUgx: number;
  conversionRatePercent: number;
  totalSubscriptionsInWindow: number;
};

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

export async function fetchPublicSubscriptionPricing(): Promise<PublicPricingSnapshot> {
  if (!supabase) return buildDefaultPublicPricing();
  const { data, error } = await supabase.rpc("public_subscription_pricing");
  if (error || !data) return buildDefaultPublicPricing();
  return mapPublicPricingRpc(data);
}

export async function fetchPricingCampaigns(): Promise<PricingCampaign[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("pricing_campaigns")
    .select("id, name, description, enabled, starts_at, ends_at, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return (data as CampaignRow[]).map(mapCampaign);
}

export async function fetchPricingCampaignDiscounts(campaignId: string): Promise<PricingCampaignPlanDiscount[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("pricing_campaign_plan_discounts")
    .select("id, campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent")
    .eq("campaign_id", campaignId);
  if (error || !data) return [];
  return (data as DiscountRow[]).map(mapDiscount);
}

export async function savePricingCampaign(campaign: {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
}): Promise<RpcResult & { campaignId?: string }> {
  if (!supabase) return { ok: false, error: "no_supabase" };
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
  if (!supabase) return { ok: false, error: "no_supabase" };
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

export async function previewPricingCampaign(campaignId: string): Promise<PublicPricingSnapshot["plans"]> {
  if (!supabase) return buildDefaultPublicPricing().plans;
  const { data, error } = await supabase.rpc("admin_pricing_campaign_preview", { p_campaign_id: campaignId });
  if (error || !data) return buildDefaultPublicPricing().plans;
  const obj = data as Record<string, unknown>;
  return mapPublicPricingRpc({ ...obj, campaign_active: false }).plans;
}

export async function fetchPricingCampaignMetrics(opts?: {
  campaignId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<PricingCampaignMetrics | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_pricing_campaign_metrics", {
    p_campaign_id: opts?.campaignId ?? null,
    p_from: opts?.from ?? null,
    p_to: opts?.to ?? null,
  });
  if (error || !data) return null;
  const obj = data as Record<string, unknown>;
  return {
    campaignId: typeof obj.campaign_id === "string" ? obj.campaign_id : null,
    campaignName: typeof obj.campaign_name === "string" ? obj.campaign_name : null,
    campaignActive: Boolean(obj.campaign_active),
    newSubscribers: Number(obj.new_subscribers ?? 0),
    newSubscribersByPlan: (obj.new_subscribers_by_plan as Record<string, number>) ?? {},
    revenueRecordedUgx: Number(obj.revenue_recorded_ugx ?? 0),
    conversionRatePercent: Number(obj.conversion_rate_percent ?? 0),
    totalSubscriptionsInWindow: Number(obj.total_subscriptions_in_window ?? 0),
  };
}

export async function fetchPricingCampaignAuditFeed(limit = 50): Promise<PricingCampaignAuditEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_pricing_campaign_audit_feed", { p_limit: limit });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    campaignId: typeof row.campaign_id === "string" ? row.campaign_id : null,
    planCode: typeof row.plan_code === "string" ? (row.plan_code as PaidPlanCode) : null,
    actorName: String(row.actor_name ?? ""),
    previousDiscount: (row.previous_discount as Record<string, unknown>) ?? {},
    newDiscount: (row.new_discount as Record<string, unknown>) ?? {},
    reason: String(row.reason ?? ""),
    createdAt: String(row.created_at ?? ""),
  }));
}

export function isPricingCampaignActive(campaign: PricingCampaign, now = new Date()): boolean {
  if (!campaign.enabled) return false;
  const t = now.getTime();
  if (campaign.startsAt) {
    const start = new Date(campaign.startsAt).getTime();
    if (Number.isFinite(start) && t < start) return false;
  }
  if (campaign.endsAt) {
    const end = new Date(campaign.endsAt).getTime();
    if (Number.isFinite(end) && t >= end) return false;
  }
  return true;
}
