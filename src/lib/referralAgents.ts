import { supabase } from "./supabase";
import type { FieldMapPin } from "./wakaInternalAdmin";

export type MarketingAgentMe = {
  referralCode: string;
  fullName: string | null;
  referralCount: number;
};

export type AgentReferralRow = {
  id: string;
  shopName: string | null;
  ownerEmail: string | null;
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
  active: boolean;
  referralCount: number;
  createdAt: string;
};

export type AgentUserCandidate = {
  key: string;
  email: string;
  fullName: string | null;
  phoneE164: string | null;
  shopName: string | null;
  district: string | null;
};

export async function fetchMarketingAgentMe(): Promise<MarketingAgentMe | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("marketing_agent_me");
  if (error || !data || typeof data !== "object") return null;
  const row = data as { ok?: boolean; error?: string; referral_code?: string; full_name?: string | null; referral_count?: number };
  if (!row.ok || row.error === "not_agent") return null;
  if (!row.referral_code) return null;
  return {
    referralCode: row.referral_code,
    fullName: row.full_name ?? null,
    referralCount: row.referral_count ?? 0,
  };
}

export async function applyReferralCode(code: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const trimmed = code.trim();
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
    const email = String(row.owner_email ?? "").trim().toLowerCase();
    if (!email) continue;
    const fullName = row.owner_label != null ? String(row.owner_label) : null;
    const phone = row.phone_e164 != null ? String(row.phone_e164) : null;
    const shopName = row.name != null ? String(row.name) : null;
    const district = row.district != null ? String(row.district) : null;
    const haystack = `${email} ${fullName ?? ""} ${phone ?? ""} ${shopName ?? ""} ${district ?? ""}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    if (byKey.has(email)) continue;
    byKey.set(email, {
      key: email,
      email,
      fullName,
      phoneE164: phone,
      shopName,
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
    owner_label: row.ownerEmail ?? null,
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
      referralCode: String(x.referral_code ?? ""),
      fullName: x.full_name != null ? String(x.full_name) : null,
      email: x.email != null ? String(x.email) : null,
      phoneE164: x.phone_e164 != null ? String(x.phone_e164) : null,
      active: Boolean(x.active),
      referralCount: Number(x.referral_count ?? 0),
      createdAt: String(x.created_at ?? ""),
    };
  });
}

export async function internalGrantMarketingAgent(email: string): Promise<{
  ok: boolean;
  id?: string;
  referralCode?: string;
  error?: string;
  alreadyAgent?: boolean;
}> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("internal_grant_marketing_agent", { p_email: email.trim() });
  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as { ok?: boolean; id?: string; referral_code?: string; error?: string; already_agent?: boolean };
  if (!row.ok) return { ok: false, error: row.error ?? "unknown" };
  return {
    ok: true,
    id: row.id,
    referralCode: row.referral_code,
    alreadyAgent: row.already_agent,
  };
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
  return { ok: true, id: row.id, referralCode: row.referral_code };
}
