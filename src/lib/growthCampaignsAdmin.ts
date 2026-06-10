/**
 * Internal Admin client for the Growth Campaign & Monetization Control system.
 * All mutations go through audited security-definer RPCs (see migration 097).
 */
import { supabase } from "./supabase";
import type {
  CampaignMetrics,
  GrowthCampaign,
  GrowthGrantMode,
  GrowthReferralCode,
  PromotionalGrant,
  PromotionalGrantSource,
  PromotionalPlanCode,
} from "./growthCampaigns";

type RpcResult = { ok: boolean; error?: string };

function rpcResult(data: unknown, error: { message: string } | null): RpcResult {
  if (error) return { ok: false, error: error.message };
  const obj = (data ?? {}) as Record<string, unknown>;
  if (obj.ok === false) return { ok: false, error: String(obj.error ?? "failed") };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

type CampaignRow = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  grant_mode: string;
  granted_plan_code: string;
  duration_days: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapCampaign(row: CampaignRow): GrowthCampaign {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    grantMode: row.grant_mode as GrowthGrantMode,
    grantedPlanCode: row.granted_plan_code as PromotionalPlanCode,
    durationDays: row.duration_days,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchGrowthCampaigns(): Promise<GrowthCampaign[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("growth_campaigns")
    .select("id, name, description, enabled, grant_mode, granted_plan_code, duration_days, starts_at, ends_at, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return (data as CampaignRow[]).map(mapCampaign);
}

export async function saveGrowthCampaign(campaign: {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  grantMode: GrowthGrantMode;
  grantedPlanCode: PromotionalPlanCode;
  durationDays: number;
  startsAt: string | null;
  endsAt: string | null;
}): Promise<RpcResult & { campaignId?: string }> {
  if (!supabase) return { ok: false, error: "no_supabase" };
  const { data, error } = await supabase.rpc("admin_growth_campaign_save", {
    p_id: campaign.id,
    p_name: campaign.name,
    p_description: campaign.description,
    p_enabled: campaign.enabled,
    p_grant_mode: campaign.grantMode,
    p_granted_plan_code: campaign.grantedPlanCode,
    p_duration_days: campaign.durationDays,
    p_starts_at: campaign.startsAt,
    p_ends_at: campaign.endsAt,
  });
  const res = rpcResult(data, error);
  const campaignId = (data as Record<string, unknown> | null)?.campaign_id;
  return { ...res, campaignId: typeof campaignId === "string" ? campaignId : undefined };
}

// ---------------------------------------------------------------------------
// Referral codes
// ---------------------------------------------------------------------------

type ReferralCodeRow = {
  id: string;
  campaign_id: string | null;
  code: string;
  description: string;
  plan_code: string;
  duration_days: number;
  enabled: boolean;
  usage_count: number;
};

export type GrowthReferralCodeWithUsage = GrowthReferralCode & { usageCount: number };

export async function fetchGrowthReferralCodes(): Promise<GrowthReferralCodeWithUsage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("growth_referral_codes")
    .select("id, campaign_id, code, description, plan_code, duration_days, enabled, usage_count")
    .order("code", { ascending: true });
  if (error || !data) return [];
  return (data as ReferralCodeRow[]).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    code: row.code,
    description: row.description,
    planCode: row.plan_code as PromotionalPlanCode,
    durationDays: row.duration_days,
    enabled: row.enabled,
    usageCount: row.usage_count,
  }));
}

export async function saveGrowthReferralCode(code: {
  id: string | null;
  campaignId: string | null;
  code: string;
  description: string;
  planCode: PromotionalPlanCode;
  durationDays: number;
  enabled: boolean;
}): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "no_supabase" };
  const { data, error } = await supabase.rpc("admin_growth_referral_code_save", {
    p_id: code.id,
    p_campaign_id: code.campaignId,
    p_code: code.code,
    p_description: code.description,
    p_plan_code: code.planCode,
    p_duration_days: code.durationDays,
    p_enabled: code.enabled,
  });
  return rpcResult(data, error);
}

// ---------------------------------------------------------------------------
// Promotional grants (manual grant / extend / revoke)
// ---------------------------------------------------------------------------

type GrantRow = {
  id: string;
  organization_id: string;
  shop_id: string | null;
  campaign_id: string | null;
  referral_code_id: string | null;
  plan_code: string;
  granted_by: string;
  granted_by_admin_id: string | null;
  reason: string | null;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
};

function mapGrant(row: GrantRow): PromotionalGrant {
  return {
    id: row.id,
    organizationId: row.organization_id,
    shopId: row.shop_id,
    campaignId: row.campaign_id,
    referralCodeId: row.referral_code_id,
    planCode: row.plan_code,
    grantedBy: row.granted_by as PromotionalGrantSource,
    grantedByAdminId: row.granted_by_admin_id,
    reason: row.reason,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export async function fetchPromotionalGrantsForShop(shopId: string): Promise<PromotionalGrant[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("promotional_grants")
    .select("id, organization_id, shop_id, campaign_id, referral_code_id, plan_code, granted_by, granted_by_admin_id, reason, granted_at, expires_at, revoked_at")
    .eq("shop_id", shopId)
    .order("granted_at", { ascending: false });
  if (error || !data) return [];
  return (data as GrantRow[]).map(mapGrant);
}

export async function fetchRecentPromotionalGrants(limit = 100): Promise<PromotionalGrant[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("promotional_grants")
    .select("id, organization_id, shop_id, campaign_id, referral_code_id, plan_code, granted_by, granted_by_admin_id, reason, granted_at, expires_at, revoked_at")
    .order("granted_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as GrantRow[]).map(mapGrant);
}

export async function adminGrantPromotionalAccess(params: {
  shopId: string;
  planCode: PromotionalPlanCode;
  days: number;
  reason: string;
  campaignId?: string | null;
}): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "no_supabase" };
  const { data, error } = await supabase.rpc("admin_grant_promotional_access", {
    p_shop_id: params.shopId,
    p_plan_code: params.planCode,
    p_days: params.days,
    p_reason: params.reason || null,
    p_campaign_id: params.campaignId ?? null,
  });
  return rpcResult(data, error);
}

export async function adminExtendPromotionalAccess(grantId: string, extraDays: number, reason?: string): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "no_supabase" };
  const { data, error } = await supabase.rpc("admin_extend_promotional_access", {
    p_grant_id: grantId,
    p_extra_days: extraDays,
    p_reason: reason || null,
  });
  return rpcResult(data, error);
}

export async function adminRevokePromotionalAccess(grantId: string, reason?: string): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "no_supabase" };
  const { data, error } = await supabase.rpc("admin_revoke_promotional_access", {
    p_grant_id: grantId,
    p_reason: reason || null,
  });
  return rpcResult(data, error);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export async function fetchGrowthCampaignMetrics(filter?: {
  campaignId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<CampaignMetrics | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_growth_campaign_metrics", {
    p_campaign_id: filter?.campaignId ?? null,
    p_from: filter?.from ?? null,
    p_to: filter?.to ?? null,
  });
  if (error || !data) return null;
  const obj = data as Record<string, unknown>;
  const num = (k: string) => {
    const v = obj[k];
    return typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0) || 0;
  };
  return {
    campaignShops: num("campaign_shops"),
    activePromotionalShops: num("active_promotional_shops"),
    expiredPromotionalShops: num("expired_promotional_shops"),
    convertedToPaid: num("converted_to_paid"),
    conversionRatePct: num("conversion_rate_pct"),
    mrrFromConvertedUgx: num("mrr_from_converted_ugx"),
  };
}

// ---------------------------------------------------------------------------
// Registration hook (owner side)
// ---------------------------------------------------------------------------

/**
 * Applies any active automatic / referral growth-campaign grant to the
 * caller's freshly bootstrapped workspace. Idempotent; safe to call on every
 * post-signup session check.
 */
export async function applyGrowthCampaignGrantForSession(referralCode?: string | null): Promise<{
  granted: boolean;
  planCode?: string;
}> {
  if (!supabase) return { granted: false };
  try {
    const { data, error } = await supabase.rpc("apply_growth_campaign_grant", {
      p_referral_code: referralCode ?? null,
    });
    if (error || !data) return { granted: false };
    const obj = data as Record<string, unknown>;
    if (obj.granted === true) {
      window.dispatchEvent(new Event("waka:subscription-updated"));
      return { granted: true, planCode: typeof obj.plan_code === "string" ? obj.plan_code : undefined };
    }
    return { granted: false };
  } catch {
    return { granted: false };
  }
}
