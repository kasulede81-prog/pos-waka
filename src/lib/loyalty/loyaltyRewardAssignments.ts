/**
 * Decision 029 — merchant reward assignment RPCs.
 */

import { hasSupabaseConfig, supabase } from "../supabase";

export type LoyaltyRewardAssignment = {
  id: string;
  rewardId: string;
  rewardName: string;
  pointsRequired: number;
  status: "active" | "revoked";
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  rewardActive: boolean;
  rewardExpiresOn: string | null;
  requiresOfferGrant: boolean;
  assignmentUsable: boolean;
  rewardUnexpired: boolean;
};

function mapRow(row: Record<string, unknown>): LoyaltyRewardAssignment {
  return {
    id: String(row.id ?? ""),
    rewardId: String(row.reward_id ?? ""),
    rewardName: String(row.reward_name ?? ""),
    pointsRequired: Math.max(0, Math.trunc(Number(row.points_required ?? 0))),
    status: row.status === "revoked" ? "revoked" : "active",
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    createdAt: String(row.created_at ?? ""),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
    rewardActive: row.reward_active !== false,
    rewardExpiresOn: row.reward_expires_on == null ? null : String(row.reward_expires_on),
    requiresOfferGrant: row.requires_offer_grant === true,
    assignmentUsable: row.assignment_usable === true,
    rewardUnexpired: row.reward_unexpired !== false,
  };
}

export async function listRewardAssignments(
  shopId: string,
  accountId: string,
): Promise<LoyaltyRewardAssignment[]> {
  if (!hasSupabaseConfig || !supabase || !shopId || !accountId) return [];
  try {
    const { data, error } = await supabase.rpc("loyalty_list_reward_assignments", {
      p_shop_id: shopId,
      p_account_id: accountId,
    });
    if (error) return [];
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok !== true) return [];
    const rows = Array.isArray(r.assignments) ? r.assignments : [];
    return rows.map((x) => mapRow(x as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function assignLoyaltyReward(
  shopId: string,
  accountId: string,
  rewardId: string,
  expiresAt?: string | null,
): Promise<{ ok: true; assignmentId: string; alreadyAssigned: boolean } | { ok: false; error: string }> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "unavailable" };
  try {
    const { data, error } = await supabase.rpc("loyalty_assign_reward", {
      p_shop_id: shopId,
      p_account_id: accountId,
      p_reward_id: rewardId,
      p_expires_at: expiresAt ?? null,
      p_note: null,
    });
    if (error) return { ok: false, error: error.code ?? "failed" };
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok !== true) return { ok: false, error: String(r.error ?? "rejected") };
    return {
      ok: true,
      assignmentId: String(r.assignment_id ?? ""),
      alreadyAssigned: r.already_assigned === true || r.reactivated === true,
    };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function revokeLoyaltyRewardAssignment(
  shopId: string,
  assignmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "unavailable" };
  try {
    const { data, error } = await supabase.rpc("loyalty_revoke_reward_assignment", {
      p_shop_id: shopId,
      p_assignment_id: assignmentId,
    });
    if (error) return { ok: false, error: error.code ?? "failed" };
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok !== true) return { ok: false, error: String(r.error ?? "rejected") };
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}
