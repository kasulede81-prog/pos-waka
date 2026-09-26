/**
 * The merchant's Loyalty entitlement + usage, read from the server's single
 * authoritative call (`shop_loyalty_usage`). Nothing here computes a limit or a count —
 * the database is the authority; this only presents it.
 */

import { hasSupabaseConfig, supabase } from "../supabase";

export type LoyaltyUsage = {
  loyaltyEnabled: boolean;
  entitlementStatus: string;
  tierCode: string | null;
  tierName: string | null;
  memberLimit: number;
  activeMembers: number;
  remaining: number;
  atLimit: boolean;
  pendingRequests: number;
  usagePercent: number;
  /** Server-side cap on the pending queue. Separate from the member allowance. */
  pendingQueueLimit: number;
  pendingQueueFull: boolean;
};

export function mapLoyaltyUsage(raw: unknown): LoyaltyUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  return {
    loyaltyEnabled: u.loyalty_enabled === true,
    entitlementStatus: String(u.entitlement_status ?? "none"),
    tierCode: u.tier_code == null ? null : String(u.tier_code),
    tierName: u.tier_name == null ? null : String(u.tier_name),
    memberLimit: Number(u.member_limit ?? 0),
    activeMembers: Number(u.active_members ?? 0),
    remaining: Number(u.remaining ?? 0),
    atLimit: u.at_limit === true,
    pendingRequests: Number(u.pending_requests ?? 0),
    usagePercent: Number(u.usage_percent ?? 0),
    pendingQueueLimit: Number(u.pending_queue_limit ?? 0),
    pendingQueueFull: u.pending_queue_full === true,
  };
}

export async function fetchLoyaltyUsage(shopId: string): Promise<LoyaltyUsage | null> {
  if (!hasSupabaseConfig || !supabase || !shopId) return null;
  try {
    const { data, error } = await supabase.rpc("shop_loyalty_usage", { p_shop_id: shopId });
    if (error) return null;
    return mapLoyaltyUsage(data);
  } catch {
    return null;
  }
}
