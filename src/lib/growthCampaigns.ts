/**
 * Growth Campaign & Monetization Control — pure domain logic.
 *
 * Promotional grants give shops temporary premium access without touching the
 * paid subscription row. When a grant expires or is revoked, the shop falls
 * back to its real subscription (paid → trial → free). Nothing here disables
 * the existing monetization system.
 */
import { normalizePlanCode, type SubscriptionPlanCode } from "./subscriptionEntitlements";

export const GROWTH_GRANT_MODES = ["automatic", "referral_based", "manual"] as const;
export type GrowthGrantMode = (typeof GROWTH_GRANT_MODES)[number];

/** Plans a campaign may grant ("plus" in marketing copy = waka_plus). */
export const PROMOTIONAL_PLAN_CODES = ["starter", "business", "waka_plus"] as const;
export type PromotionalPlanCode = (typeof PROMOTIONAL_PLAN_CODES)[number];

export type GrowthCampaign = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  grantMode: GrowthGrantMode;
  grantedPlanCode: PromotionalPlanCode;
  durationDays: number;
  /** ISO datetime; null = no lower bound. */
  startsAt: string | null;
  /** ISO datetime; null = no upper bound. */
  endsAt: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type GrowthReferralCode = {
  id: string;
  campaignId: string | null;
  code: string;
  description: string;
  planCode: PromotionalPlanCode;
  durationDays: number;
  enabled: boolean;
};

export type PromotionalGrantSource = "growth_campaign" | "referral_code" | "manual_admin";

export type PromotionalGrant = {
  id: string;
  organizationId: string;
  shopId: string | null;
  campaignId: string | null;
  referralCodeId: string | null;
  planCode: string;
  grantedBy: PromotionalGrantSource;
  grantedByAdminId: string | null;
  reason: string | null;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

const MS_DAY = 86_400_000;

export function isPromotionalPlanCode(raw: string | null | undefined): raw is PromotionalPlanCode {
  return raw === "starter" || raw === "business" || raw === "waka_plus";
}

export function normalizePromotionalPlanCode(raw: string | null | undefined): PromotionalPlanCode | null {
  const code = normalizePlanCode(raw);
  return code === "free" ? null : code;
}

/** Campaign Active (computed): enabled AND now inside [startsAt, endsAt). */
export function isCampaignActive(campaign: GrowthCampaign | null | undefined, nowMs: number = Date.now()): boolean {
  if (!campaign || !campaign.enabled) return false;
  if (campaign.durationDays <= 0) return false;
  if (campaign.startsAt) {
    const start = new Date(campaign.startsAt).getTime();
    if (Number.isFinite(start) && nowMs < start) return false;
  }
  if (campaign.endsAt) {
    const end = new Date(campaign.endsAt).getTime();
    if (Number.isFinite(end) && nowMs >= end) return false;
  }
  return true;
}

export function isGrantActive(
  grant: Pick<PromotionalGrant, "expiresAt" | "revokedAt"> | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!grant) return false;
  if (grant.revokedAt) return false;
  const end = new Date(grant.expiresAt).getTime();
  return Number.isFinite(end) && end > nowMs;
}

export function computeGrantExpiry(grantedAtIso: string, durationDays: number): string {
  const start = new Date(grantedAtIso).getTime();
  const days = Math.max(1, Math.floor(durationDays));
  return new Date(start + days * MS_DAY).toISOString();
}

/** Extension never shortens: extends from the later of now / current expiry. */
export function extendGrantExpiry(
  grant: Pick<PromotionalGrant, "expiresAt">,
  extraDays: number,
  nowMs: number = Date.now(),
): string {
  const current = new Date(grant.expiresAt).getTime();
  const base = Number.isFinite(current) ? Math.max(current, nowMs) : nowMs;
  return new Date(base + Math.max(1, Math.floor(extraDays)) * MS_DAY).toISOString();
}

export type RegistrationGrantDecision = {
  planCode: PromotionalPlanCode;
  durationDays: number;
  grantedBy: Extract<PromotionalGrantSource, "growth_campaign" | "referral_code">;
  campaignId: string | null;
  referralCodeId: string | null;
};

/**
 * Decides which promotional grant (if any) a newly registered shop receives.
 * - automatic: every new shop gets the campaign plan/duration.
 * - referral_based: only shops registered with an enabled referral/agent code.
 * - manual: never granted at registration.
 */
export function resolveRegistrationGrant(params: {
  campaign: GrowthCampaign | null;
  referralCodes?: GrowthReferralCode[];
  usedReferralCode?: string | null;
  nowMs?: number;
}): RegistrationGrantDecision | null {
  const { campaign, referralCodes = [], usedReferralCode } = params;
  const nowMs = params.nowMs ?? Date.now();
  if (!isCampaignActive(campaign, nowMs)) return null;
  const active = campaign as GrowthCampaign;

  if (active.grantMode === "automatic") {
    return {
      planCode: active.grantedPlanCode,
      durationDays: active.durationDays,
      grantedBy: "growth_campaign",
      campaignId: active.id,
      referralCodeId: null,
    };
  }

  if (active.grantMode === "referral_based") {
    const used = (usedReferralCode ?? "").trim().toUpperCase();
    if (!used) return null;
    const match = referralCodes.find((c) => c.enabled && c.code.trim().toUpperCase() === used);
    if (!match) return null;
    return {
      planCode: match.planCode,
      durationDays: match.durationDays,
      grantedBy: "referral_code",
      campaignId: match.campaignId ?? active.id,
      referralCodeId: match.id,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

export const GROWTH_AUDIT_ACTIONS = [
  "growth_campaign_created",
  "growth_campaign_updated",
  "promotional_access_granted",
  "promotional_access_extended",
  "promotional_access_revoked",
  "referral_code_created",
  "referral_code_used",
] as const;
export type GrowthAuditAction = (typeof GROWTH_AUDIT_ACTIONS)[number];

export type GrowthAuditEvent = {
  action: GrowthAuditAction;
  at: string;
  adminId: string | null;
  shopId: string | null;
  campaignId: string | null;
  planCode: string | null;
  durationDays: number | null;
  reason: string | null;
  summary: string;
};

export function buildGrowthAuditEvent(params: {
  action: GrowthAuditAction;
  at?: string;
  adminId?: string | null;
  shopId?: string | null;
  campaignId?: string | null;
  planCode?: string | null;
  durationDays?: number | null;
  reason?: string | null;
}): GrowthAuditEvent {
  const planPart = params.planCode ? ` plan=${params.planCode}` : "";
  const daysPart = params.durationDays != null ? ` days=${params.durationDays}` : "";
  return {
    action: params.action,
    at: params.at ?? new Date().toISOString(),
    adminId: params.adminId ?? null,
    shopId: params.shopId ?? null,
    campaignId: params.campaignId ?? null,
    planCode: params.planCode ?? null,
    durationDays: params.durationDays ?? null,
    reason: params.reason ?? null,
    summary: `${params.action}${planPart}${daysPart}`.trim(),
  };
}

// ---------------------------------------------------------------------------
// Conversion metrics
// ---------------------------------------------------------------------------

export type CampaignSubscriptionRow = {
  organizationId: string;
  planCode: string;
  status: string;
  currentPeriodEnd: string | null;
  /** True for real owner payments — manual admin/VIP rows must not count as conversions. */
  paid: boolean;
  monthlyPriceUgx: number;
};

export type CampaignMetrics = {
  campaignShops: number;
  activePromotionalShops: number;
  expiredPromotionalShops: number;
  convertedToPaid: number;
  conversionRatePct: number;
  mrrFromConvertedUgx: number;
};

export function computeCampaignMetrics(
  grants: PromotionalGrant[],
  subscriptions: CampaignSubscriptionRow[],
  opts?: { campaignId?: string | null; fromMs?: number | null; toMs?: number | null; nowMs?: number },
): CampaignMetrics {
  const nowMs = opts?.nowMs ?? Date.now();
  const filtered = grants.filter((g) => {
    if (opts?.campaignId && g.campaignId !== opts.campaignId) return false;
    const at = new Date(g.grantedAt).getTime();
    if (opts?.fromMs != null && at < opts.fromMs) return false;
    if (opts?.toMs != null && at > opts.toMs) return false;
    return true;
  });

  const byOrg = new Map<string, PromotionalGrant[]>();
  for (const g of filtered) {
    const list = byOrg.get(g.organizationId) ?? [];
    list.push(g);
    byOrg.set(g.organizationId, list);
  }

  let active = 0;
  let expired = 0;
  for (const list of byOrg.values()) {
    if (list.some((g) => isGrantActive(g, nowMs))) active += 1;
    else expired += 1;
  }

  const paidByOrg = new Map<string, CampaignSubscriptionRow>();
  for (const sub of subscriptions) {
    if (!sub.paid) continue;
    if ((sub.status ?? "").trim().toLowerCase() !== "active") continue;
    if (normalizePlanCode(sub.planCode) === "free") continue;
    if (sub.currentPeriodEnd) {
      const end = new Date(sub.currentPeriodEnd).getTime();
      if (Number.isFinite(end) && end <= nowMs) continue;
    }
    paidByOrg.set(sub.organizationId, sub);
  }

  let converted = 0;
  let mrr = 0;
  for (const orgId of byOrg.keys()) {
    const sub = paidByOrg.get(orgId);
    if (!sub) continue;
    converted += 1;
    mrr += sub.monthlyPriceUgx;
  }

  const campaignShops = byOrg.size;
  return {
    campaignShops,
    activePromotionalShops: active,
    expiredPromotionalShops: expired,
    convertedToPaid: converted,
    conversionRatePct: campaignShops === 0 ? 0 : Math.round((converted / campaignShops) * 1000) / 10,
    mrrFromConvertedUgx: mrr,
  };
}

export function promotionalPlanLabel(code: PromotionalPlanCode): string {
  if (code === "starter") return "Starter";
  if (code === "business") return "Business";
  return "Waka Plus";
}

export function planTierLabel(code: SubscriptionPlanCode): string {
  return code === "free" ? "Free" : promotionalPlanLabel(code);
}
