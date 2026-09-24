/**
 * Loyalty cloud data access (Phase 03).
 *
 * Read-only consumption + idempotent enrollment. Points are NEVER credited
 * here — awarding is server-side (loyalty_award_for_sale trigger). Every
 * function is failure-isolated: network/RLP errors resolve to null/false and
 * never throw into the checkout flow.
 */

import { hasSupabaseConfig, supabase } from "../supabase";
import type {
  LoyaltyAccountSnapshot,
  LoyaltyProgramConfig,
  MembershipExpiryMode,
} from "./loyaltyMath";

const PROGRAM_CACHE_PREFIX = "waka-loyalty-program:";

type ProgramRow = {
  enabled: boolean;
  earn_unit_ugx: number;
  earn_points_per_unit: number;
  min_eligible_spend_ugx: number;
  rule_kind?: string;
  membership_expiry_mode?: string | null;
  membership_fixed_expires_on?: string | null;
  membership_duration_months?: number | null;
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
  membership_expires_at?: string | null;
};

function parseMembershipMode(raw: unknown): MembershipExpiryMode {
  const v = String(raw ?? "never").toLowerCase();
  if (v === "fixed_date" || v === "duration") return v;
  return "never";
}

/** Client-side mirror of RPC membership_active (display only — server is authoritative). */
export function isMembershipActiveClient(
  status: string,
  membershipExpiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (status !== "active") return false;
  if (!membershipExpiresAt) return true;
  const t = Date.parse(membershipExpiresAt);
  if (!Number.isFinite(t)) return true;
  return nowMs < t;
}

export function mapProgramRow(row: ProgramRow): LoyaltyProgramConfig {
  return {
    enabled: row.enabled,
    earnUnitUgx: Number(row.earn_unit_ugx),
    earnPointsPerUnit: Number(row.earn_points_per_unit),
    minEligibleSpendUgx: Number(row.min_eligible_spend_ugx),
    membershipExpiryMode: parseMembershipMode(row.membership_expiry_mode),
    membershipFixedExpiresOn: row.membership_fixed_expires_on
      ? String(row.membership_fixed_expires_on).slice(0, 10)
      : null,
    membershipDurationMonths:
      row.membership_duration_months == null
        ? null
        : Math.trunc(Number(row.membership_duration_months)),
  };
}

export function mapAccountRow(row: AccountRow): LoyaltyAccountSnapshot {
  const membershipExpiresAt =
    row.membership_expires_at == null || String(row.membership_expires_at).trim() === ""
      ? null
      : String(row.membership_expires_at);
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
    membershipExpiresAt,
    membershipActive: isMembershipActiveClient(row.status, membershipExpiresAt),
    membershipExpiresOn: null,
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
      .select(
        "enabled, earn_unit_ugx, earn_points_per_unit, min_eligible_spend_ugx, rule_kind, membership_expiry_mode, membership_fixed_expires_on, membership_duration_months",
      )
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
        "id, shop_id, customer_id, status, balance_points, lifetime_earned_points, lifetime_redeemed_points, qr_token, enrolled_at, membership_expires_at",
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
export async function enrollLoyaltyCustomer(
  shopId: string,
  customerId: string,
  opts: { consentAccepted?: boolean; consentNote?: string } = {},
): Promise<EnrollResult> {
  if (!hasSupabaseConfig || !supabase || !shopId || !customerId) {
    return { ok: false, error: "loyalty_unavailable" };
  }
  try {
    const { data, error } = await supabase.rpc("loyalty_enroll_customer", {
      p_shop_id: shopId,
      p_customer_id: customerId,
      p_consent_accepted: opts.consentAccepted ?? false,
      p_consent_note: opts.consentNote ?? null,
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
