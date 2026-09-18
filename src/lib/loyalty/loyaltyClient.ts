/**
 * Loyalty cloud data access (Phase 03).
 *
 * Read-only consumption + idempotent enrollment. Points are NEVER credited
 * here — awarding is server-side (loyalty_award_for_sale trigger). Every
 * function is failure-isolated: network/RLP errors resolve to null/false and
 * never throw into the checkout flow.
 */

import { hasSupabaseConfig, supabase } from "../supabase";
import type { LoyaltyAccountSnapshot, LoyaltyProgramConfig } from "./loyaltyMath";

const PROGRAM_CACHE_PREFIX = "waka-loyalty-program:";

type ProgramRow = {
  enabled: boolean;
  earn_unit_ugx: number;
  earn_points_per_unit: number;
  min_eligible_spend_ugx: number;
  rule_kind: string;
};

type AccountRow = {
  id: string;
  shop_id: string;
  customer_id: string;
  status: "active" | "disabled";
  balance_points: number;
  lifetime_earned_points: number;
  lifetime_redeemed_points: number;
  qr_token: string;
  enrolled_at: string;
};

export function mapProgramRow(row: ProgramRow): LoyaltyProgramConfig {
  return {
    enabled: row.enabled,
    earnUnitUgx: Number(row.earn_unit_ugx),
    earnPointsPerUnit: Number(row.earn_points_per_unit),
    minEligibleSpendUgx: Number(row.min_eligible_spend_ugx),
  };
}

export function mapAccountRow(row: AccountRow): LoyaltyAccountSnapshot {
  return {
    id: row.id,
    shopId: row.shop_id,
    customerId: row.customer_id,
    status: row.status,
    balancePoints: Number(row.balance_points),
    lifetimeEarnedPoints: Number(row.lifetime_earned_points),
    lifetimeRedeemedPoints: Number(row.lifetime_redeemed_points),
    qrToken: row.qr_token,
    enrolledAt: row.enrolled_at,
  };
}

function readCachedProgram(shopId: string): LoyaltyProgramConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROGRAM_CACHE_PREFIX + shopId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LoyaltyProgramConfig;
    if (typeof parsed.earnUnitUgx !== "number" || parsed.earnUnitUgx <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedProgram(shopId: string, config: LoyaltyProgramConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROGRAM_CACHE_PREFIX + shopId, JSON.stringify(config));
  } catch {
    /* quota/privacy errors are fine — cache is a bonus */
  }
}

/** Drop the offline program cache after a merchant config change (Phase 04). */
export function clearCachedProgram(shopId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PROGRAM_CACHE_PREFIX + shopId);
  } catch {
    /* ignore */
  }
}

/**
 * Fetch the shop's loyalty program. On network failure fall back to the last
 * cached config so offline checkout can still show an *estimate* (the award
 * itself is server-side and happens at sync time).
 */
export async function fetchLoyaltyProgramConfig(
  shopId: string,
): Promise<{ config: LoyaltyProgramConfig | null; fromCache: boolean }> {
  if (!hasSupabaseConfig || !supabase || !shopId) {
    return { config: readCachedProgram(shopId), fromCache: true };
  }
  try {
    const { data, error } = await supabase
      .from("loyalty_programs")
      .select("enabled, earn_unit_ugx, earn_points_per_unit, min_eligible_spend_ugx, rule_kind")
      .eq("shop_id", shopId)
      .maybeSingle();
    if (error || !data) return { config: readCachedProgram(shopId), fromCache: true };
    const config = mapProgramRow(data as ProgramRow);
    writeCachedProgram(shopId, config);
    return { config, fromCache: false };
  } catch {
    return { config: readCachedProgram(shopId), fromCache: true };
  }
}

/** Account (membership) for one customer in one shop; null when not enrolled. */
export async function fetchLoyaltyAccount(
  shopId: string,
  customerId: string,
): Promise<LoyaltyAccountSnapshot | null> {
  if (!hasSupabaseConfig || !supabase || !shopId || !customerId) return null;
  try {
    const { data, error } = await supabase
      .from("loyalty_accounts")
      .select(
        "id, shop_id, customer_id, status, balance_points, lifetime_earned_points, lifetime_redeemed_points, qr_token, enrolled_at",
      )
      .eq("shop_id", shopId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error || !data) return null;
    return mapAccountRow(data as AccountRow);
  } catch {
    return null;
  }
}

export type EnrollResult =
  | { ok: true; accountId: string; qrToken: string; alreadyEnrolled: boolean }
  | { ok: false; error: string };

/** Idempotent enrollment via the security-definer RPC (RLS-checked inside). */
export async function enrollLoyaltyCustomer(shopId: string, customerId: string): Promise<EnrollResult> {
  if (!hasSupabaseConfig || !supabase || !shopId || !customerId) {
    return { ok: false, error: "loyalty_unavailable" };
  }
  try {
    const { data, error } = await supabase.rpc("loyalty_enroll_customer", {
      p_shop_id: shopId,
      p_customer_id: customerId,
    });
    if (error) return { ok: false, error: error.code ?? "loyalty_enroll_failed" };
    const result = (data ?? {}) as { ok?: boolean; error?: string; account_id?: string; qr_token?: string; already_enrolled?: boolean };
    if (!result.ok) return { ok: false, error: result.error ?? "loyalty_enroll_rejected" };
    return {
      ok: true,
      accountId: result.account_id ?? "",
      qrToken: result.qr_token ?? "",
      alreadyEnrolled: Boolean(result.already_enrolled),
    };
  } catch {
    return { ok: false, error: "loyalty_enroll_failed" };
  }
}
