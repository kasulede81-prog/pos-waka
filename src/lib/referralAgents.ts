import { supabase } from "./supabase";

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
    };
  });
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
