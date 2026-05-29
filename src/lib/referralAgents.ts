import { isPhoneLoginEmail } from "./authPhoneEmail";
import { supabase } from "./supabase";
import type { FieldMapPin } from "./wakaInternalAdmin";

export type MarketingAgentRole = "trial_agent" | "vip_agent" | "field_agent";

export const MARKETING_AGENT_ROLES: MarketingAgentRole[] = ["trial_agent", "vip_agent", "field_agent"];

export type MarketingAgentMe = {
  referralCode: string;
  fullName: string | null;
  referralCount: number;
  roles: MarketingAgentRole[];
  canActivateTrial: boolean;
  canActivateVip: boolean;
};

export type AgentReferralRow = {
  id: string;
  shopName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  createdAt: string;
  shopId?: string | null;
  district?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  planCode?: string | null;
  subscriptionStatus?: string | null;
};

export type InternalMarketingAgentRow = {
  id: string;
  referralCode: string;
  fullName: string | null;
  email: string | null;
  phoneE164: string | null;
  shopId: string | null;
  shopName: string | null;
  active: boolean;
  roles: MarketingAgentRole[];
  referralCount: number;
  createdAt: string;
};

export type AgentUserCandidate = {
  key: string;
  shopId: string;
  shopName: string;
  fullName: string | null;
  phoneE164: string | null;
  email: string | null;
  district: string | null;
};

/** Referral codes are always shown and stored in ALL CAPS (e.g. WAKA-A1B2). */
export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Hide synthetic phone-login emails; show phone and email when both exist. */
export function formatOwnerContactLabel(email: string | null, phoneE164: string | null): string {
  const parts: string[] = [];
  if (phoneE164?.trim()) parts.push(phoneE164.trim());
  if (email?.trim() && !isPhoneLoginEmail(email)) parts.push(email.trim());
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export async function fetchMarketingAgentMe(): Promise<MarketingAgentMe | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("marketing_agent_me");
  if (error || !data || typeof data !== "object") return null;
  const row = data as {
    ok?: boolean;
    error?: string;
    referral_code?: string;
    full_name?: string | null;
    referral_count?: number;
    roles?: unknown;
    can_activate_trial?: boolean;
    can_activate_vip?: boolean;
  };
  if (!row.ok || row.error === "not_agent") return null;
  if (!row.referral_code) return null;
  const roles = parseAgentRoles(row.roles);
  return {
    referralCode: normalizeReferralCode(row.referral_code),
    fullName: row.full_name ?? null,
    referralCount: row.referral_count ?? 0,
    roles,
    canActivateTrial: Boolean(row.can_activate_trial) || roles.includes("trial_agent") || roles.includes("vip_agent"),
    canActivateVip: Boolean(row.can_activate_vip) || roles.includes("vip_agent"),
  };
}

function parseAgentRoles(raw: unknown): MarketingAgentRole[] {
  if (!Array.isArray(raw)) return ["field_agent"];
  const out: MarketingAgentRole[] = [];
  for (const r of raw) {
    const s = String(r);
    if (s === "trial_agent" || s === "vip_agent" || s === "field_agent") {
      if (!out.includes(s)) out.push(s);
    }
  }
  return out.length ? out : ["field_agent"];
}

export async function applyReferralCode(code: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const trimmed = normalizeReferralCode(code);
  if (trimmed.length < 3) return { ok: false, error: "invalid_code" };
  const { data, error } = await supabase.rpc("apply_referral_code", { p_code: trimmed });
  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as { ok?: boolean; error?: string; already_applied?: boolean };
  if (row.ok) return { ok: true };
  return { ok: false, error: row.error ?? "unknown" };
}

export async function listAgentReferrals(agentId?: string): Promise<AgentReferralRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_agent_referrals", { p_agent_id: agentId ?? null });
  if (error || !data || typeof data !== "object") return [];
  const row = data as { ok?: boolean; rows?: unknown[] };
  if (!row.ok || !Array.isArray(row.rows)) return [];
  return row.rows.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: String(x.id ?? ""),
      shopName: x.shop_name != null ? String(x.shop_name) : null,
      ownerEmail: x.owner_email != null ? String(x.owner_email) : null,
      ownerPhone: x.owner_phone != null ? String(x.owner_phone) : null,
      createdAt: String(x.created_at ?? ""),
      shopId: x.shop_id != null ? String(x.shop_id) : null,
      district: x.district != null ? String(x.district) : null,
      city: x.city != null ? String(x.city) : null,
      latitude: Number.isFinite(Number(x.latitude)) ? Number(x.latitude) : null,
      longitude: Number.isFinite(Number(x.longitude)) ? Number(x.longitude) : null,
      planCode: x.plan_code != null ? String(x.plan_code) : null,
      subscriptionStatus: x.subscription_status != null ? String(x.subscription_status) : null,
    };
  });
}

export async function internalSearchAgentUserCandidates(query: string, limit = 120): Promise<AgentUserCandidate[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_recent_shops", {
    p_limit: Math.min(Math.max(limit, 20), 300),
  });
  if (error || !Array.isArray(data)) return [];
  const q = query.trim().toLowerCase();
  const byKey = new Map<string, AgentUserCandidate>();
  for (const raw of data) {
    const row = raw as Record<string, unknown>;
    const shopId = String(row.id ?? "").trim();
    if (!shopId) continue;
    const shopName = row.name != null ? String(row.name).trim() : "Shop";
    const fullName = row.owner_label != null ? String(row.owner_label) : null;
    const phone = row.phone_e164 != null ? String(row.phone_e164) : null;
    const email = row.owner_email != null ? String(row.owner_email).trim().toLowerCase() : null;
    const district = row.district != null ? String(row.district) : null;
    const haystack = `${shopName} ${fullName ?? ""} ${phone ?? ""} ${email ?? ""} ${district ?? ""}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    if (byKey.has(shopId)) continue;
    byKey.set(shopId, {
      key: shopId,
      shopId,
      shopName,
      fullName,
      phoneE164: phone,
      email,
      district,
    });
  }
  return [...byKey.values()].slice(0, limit);
}

export function referralRowToMapPin(row: AgentReferralRow): FieldMapPin | null {
  if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return null;
  return {
    shop_id: row.shopId ?? row.id,
    shop_name: row.shopName ?? "Shop",
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    district: row.district ?? null,
    city: row.city ?? null,
    is_active: (row.subscriptionStatus ?? "").toLowerCase() !== "inactive",
    district_id: null,
    owner_label: formatOwnerContactLabel(row.ownerEmail, row.ownerPhone),
    plan_code: row.planCode ?? null,
    subscription_status: row.subscriptionStatus ?? null,
    last_seen_at: row.createdAt ?? null,
  };
}

export async function internalListMarketingAgents(): Promise<InternalMarketingAgentRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_list_marketing_agents");
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: String(x.id ?? ""),
      referralCode: normalizeReferralCode(String(x.referral_code ?? "")),
      fullName: x.full_name != null ? String(x.full_name) : null,
      email: x.email != null ? String(x.email) : null,
      phoneE164: x.phone_e164 != null ? String(x.phone_e164) : null,
      shopId: x.shop_id != null ? String(x.shop_id) : null,
      shopName: x.shop_name != null ? String(x.shop_name) : null,
      active: Boolean(x.active),
      roles: parseAgentRoles(x.roles),
      referralCount: Number(x.referral_count ?? 0),
      createdAt: String(x.created_at ?? ""),
    };
  });
}

/** Grant field-agent access to the owner of an existing shop (phone sign-up friendly). */
export async function internalGrantMarketingAgentByShop(shopId: string): Promise<{
  ok: boolean;
  id?: string;
  referralCode?: string;
  shopName?: string;
  error?: string;
  alreadyAgent?: boolean;
}> {
  if (!supabase) return { ok: false, error: "offline" };
  const trimmed = shopId.trim();
  if (!trimmed) return { ok: false, error: "shop_required" };
  const { data, error } = await supabase.rpc("internal_grant_marketing_agent_by_shop", {
    p_shop_id: trimmed,
    p_roles: ["trial_agent", "field_agent"],
  });
  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as {
    ok?: boolean;
    id?: string;
    referral_code?: string;
    shop_name?: string;
    error?: string;
    already_agent?: boolean;
  };
  if (!row.ok) return { ok: false, error: row.error ?? "unknown" };
  return {
    ok: true,
    id: row.id,
    referralCode: row.referral_code ? normalizeReferralCode(row.referral_code) : undefined,
    shopName: row.shop_name,
    alreadyAgent: row.already_agent,
  };
}

export async function internalSetMarketingAgentRoles(
  agentId: string,
  roles: MarketingAgentRole[],
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("internal_set_marketing_agent_roles", {
    p_agent_id: agentId,
    p_roles: roles,
  });
  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as { ok?: boolean; error?: string };
  if (!row.ok) return { ok: false, error: row.error ?? "unknown" };
  return { ok: true };
}

export async function internalGrantMarketingAgentByShopWithRoles(
  shopId: string,
  roles: MarketingAgentRole[],
): Promise<{
  ok: boolean;
  id?: string;
  referralCode?: string;
  shopName?: string;
  error?: string;
  alreadyAgent?: boolean;
}> {
  if (!supabase) return { ok: false, error: "offline" };
  const trimmed = shopId.trim();
  if (!trimmed) return { ok: false, error: "shop_required" };
  const { data, error } = await supabase.rpc("internal_grant_marketing_agent_by_shop", {
    p_shop_id: trimmed,
    p_roles: roles.length ? roles : ["field_agent"],
  });
  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as {
    ok?: boolean;
    id?: string;
    referral_code?: string;
    shop_name?: string;
    error?: string;
    already_agent?: boolean;
  };
  if (!row.ok) return { ok: false, error: row.error ?? "unknown" };
  return {
    ok: true,
    id: row.id,
    referralCode: row.referral_code ? normalizeReferralCode(row.referral_code) : undefined,
    shopName: row.shop_name,
    alreadyAgent: row.already_agent,
  };
}

export async function marketingAgentUpgradeReferralPlan(input: {
  referralId: string;
  planCode: "starter" | "business" | "waka_plus";
  days?: number;
}): Promise<{ ok: boolean; error?: string; planCode?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("marketing_agent_upgrade_referral_plan", {
    p_referral_id: input.referralId,
    p_plan_code: input.planCode,
    p_days: input.days ?? 30,
  });
  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as { ok?: boolean; error?: string; plan_code?: string };
  if (!row.ok) return { ok: false, error: row.error ?? "unknown" };
  return { ok: true, planCode: row.plan_code };
}

export async function internalCreateMarketingAgent(input: {
  referralCode: string;
  fullName?: string;
  email?: string;
  phoneE164?: string;
  userId?: string;
}): Promise<{ ok: boolean; id?: string; referralCode?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("internal_create_marketing_agent", {
    p_referral_code: input.referralCode.trim(),
    p_full_name: input.fullName?.trim() || null,
    p_email: input.email?.trim() || null,
    p_phone_e164: input.phoneE164?.trim() || null,
    p_user_id: input.userId?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as { ok?: boolean; id?: string; referral_code?: string; error?: string };
  if (!row.ok) return { ok: false, error: row.error ?? "unknown" };
  return {
    ok: true,
    id: row.id,
    referralCode: row.referral_code ? normalizeReferralCode(row.referral_code) : undefined,
  };
}
