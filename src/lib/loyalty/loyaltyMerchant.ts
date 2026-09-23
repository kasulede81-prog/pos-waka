/**
 * Loyalty merchant data layer (Phase 04).
 *
 * Merchant-facing reads (overview, account directory, history) and the
 * manager-only program configuration upsert. Points are NEVER credited here:
 * adjustments go through the security-definer `loyalty_adjust_points` RPC,
 * which re-checks manager authorization in the database.
 */

import { hasSupabaseConfig, supabase } from "../supabase";
import {
  clearCachedProgram,
  fetchLoyaltyProgramConfig,
  mapProgramRow,
} from "./loyaltyClient";
import type { LoyaltyProgramConfig, LoyaltyTransactionKind, LoyaltyTransactionRow } from "./loyaltyMath";

export type LoyaltyOverview = {
  program: LoyaltyProgramConfig | null;
  programUpdatedAt: string | null;
  membersTotal: number;
  membersActive: number;
  pointsIssued: number;
  pointsRedeemed: number;
  pointsReversed: number;
  recentActivity: LoyaltyActivityEntry[];
};

export type LoyaltyActivityEntry = {
  id: string;
  accountId: string;
  customerName: string;
  kind: LoyaltyTransactionKind;
  points: number;
  balanceAfter: number | null;
  cause: string;
  note: string | null;
  createdAt: string;
};

export type LoyaltyAccountListEntry = {
  accountId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  status: "active" | "disabled";
  balancePoints: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
  enrolledAt: string;
};

/**
 * Fetch the opaque membership QR token for an account (shop-scoped RLS).
 * Used so merchants can re-show a customer's QR without re-enrolling.
 * Does not change token generation — read-only.
 */
export async function fetchLoyaltyAccountQrToken(
  shopId: string,
  accountId: string,
): Promise<string | null> {
  if (!hasSupabaseConfig || !supabase || !shopId || !accountId) return null;
  try {
    const { data, error } = await supabase
      .from("loyalty_accounts")
      .select("qr_token")
      .eq("shop_id", shopId)
      .eq("id", accountId)
      .maybeSingle();
    if (error || !data) return null;
    const token = String((data as { qr_token?: string }).qr_token ?? "").trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Fetch opaque public_card_token for the customer loyalty page URL (shop-scoped RLS).
 * Independent from qr_token. Merchants use this only to build the page link —
 * the raw token must not be shown as technical UI.
 */
export async function fetchLoyaltyAccountPublicCardToken(
  shopId: string,
  accountId: string,
): Promise<string | null> {
  if (!hasSupabaseConfig || !supabase || !shopId || !accountId) return null;
  try {
    const { data, error } = await supabase
      .from("loyalty_accounts")
      .select("public_card_token")
      .eq("shop_id", shopId)
      .eq("id", accountId)
      .maybeSingle();
    if (error || !data) return null;
    const token = String((data as { public_card_token?: string }).public_card_token ?? "").trim();
    return token || null;
  } catch {
    return null;
  }
}

export type ProgramInput = {
  enabled: boolean;
  earnUnitUgx: number;
  earnPointsPerUnit: number;
  minEligibleSpendUgx: number;
};

export type ProgramInputError =
  | "invalid_earn_unit"
  | "invalid_points_per_unit"
  | "invalid_min_spend";

/**
 * Client-side guard mirroring the RPC validation so the UI can flag bad
 * input before round-tripping. Returns null when the input is usable.
 */
export function validateProgramInput(input: ProgramInput): ProgramInputError | null {
  if (!Number.isFinite(input.earnUnitUgx) || input.earnUnitUgx <= 0) return "invalid_earn_unit";
  if (!Number.isInteger(input.earnPointsPerUnit) || input.earnPointsPerUnit <= 0)
    return "invalid_points_per_unit";
  if (!Number.isFinite(input.minEligibleSpendUgx) || input.minEligibleSpendUgx < 0)
    return "invalid_min_spend";
  return null;
}

export async function fetchLoyaltyOverview(shopId: string): Promise<LoyaltyOverview | null> {
  if (!hasSupabaseConfig || !supabase || !shopId) return null;
  try {
    const { data, error } = await supabase.rpc("loyalty_shop_overview", { p_shop_id: shopId });
    if (error) return null;
    const result = (data ?? {}) as {
      ok?: boolean;
      program?: Record<string, unknown> | null;
      members_total?: number;
      members_active?: number;
      points_issued?: number;
      points_redeemed?: number;
      points_reversed?: number;
      recent_activity?: Record<string, unknown>[];
    };
    if (!result.ok) return null;
    return {
      program: result.program
        ? mapProgramRow(result.program as Parameters<typeof mapProgramRow>[0])
        : null,
      programUpdatedAt: (result.program?.updated_at as string | undefined) ?? null,
      membersTotal: Number(result.members_total ?? 0),
      membersActive: Number(result.members_active ?? 0),
      pointsIssued: Number(result.points_issued ?? 0),
      pointsRedeemed: Number(result.points_redeemed ?? 0),
      pointsReversed: Number(result.points_reversed ?? 0),
      recentActivity: Array.isArray(result.recent_activity)
        ? result.recent_activity.map((row) => ({
            id: String(row.id),
            accountId: String(row.account_id),
            customerName: String(row.customer_name ?? ""),
            kind: row.kind as LoyaltyActivityEntry["kind"],
            points: Number(row.points ?? 0),
            balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
            cause: String(row.cause ?? ""),
            note: (row.note as string | null) ?? null,
            createdAt: String(row.created_at ?? ""),
          }))
        : [],
    };
  } catch {
    return null;
  }
}

export type SaveProgramResult = { ok: true } | { ok: false; error: string };

export async function saveLoyaltyProgram(shopId: string, input: ProgramInput): Promise<SaveProgramResult> {
  const invalid = validateProgramInput(input);
  if (invalid) return { ok: false, error: invalid };
  if (!hasSupabaseConfig || !supabase || !shopId) return { ok: false, error: "loyalty_unavailable" };
  try {
    const { data, error } = await supabase.rpc("loyalty_update_program", {
      p_shop_id: shopId,
      p_enabled: input.enabled,
      p_earn_unit_ugx: Math.floor(input.earnUnitUgx),
      p_earn_points_per_unit: input.earnPointsPerUnit,
      p_min_eligible_spend_ugx: Math.floor(input.minEligibleSpendUgx),
    });
    if (error) return { ok: false, error: error.code ?? "loyalty_program_save_failed" };
    const result = (data ?? {}) as { ok?: boolean; error?: string };
    if (!result.ok) return { ok: false, error: result.error ?? "loyalty_program_save_rejected" };
    clearCachedProgram(shopId);
    // Refresh the checkout-side cache with the freshly saved config.
    void fetchLoyaltyProgramConfig(shopId);
    return { ok: true };
  } catch {
    return { ok: false, error: "loyalty_program_save_failed" };
  }
}

export async function searchLoyaltyAccounts(
  shopId: string,
  query: string,
): Promise<LoyaltyAccountListEntry[]> {
  if (!hasSupabaseConfig || !supabase || !shopId) return [];
  try {
    const { data, error } = await supabase.rpc("loyalty_search_accounts", {
      p_shop_id: shopId,
      p_query: query.trim() || null,
      p_limit: 50,
    });
    if (error) return [];
    const result = (data ?? {}) as { ok?: boolean; accounts?: Record<string, unknown>[] };
    if (!result.ok || !Array.isArray(result.accounts)) return [];
    return result.accounts.map((row) => ({
      accountId: String(row.id),
      customerId: String(row.customer_id),
      customerName: String(row.customer_name ?? ""),
      customerPhone: (row.customer_phone as string | null) ?? null,
      status: row.status === "disabled" ? "disabled" : "active",
      balancePoints: Number(row.balance_points ?? 0),
      lifetimeEarnedPoints: Number(row.lifetime_earned_points ?? 0),
      lifetimeRedeemedPoints: Number(row.lifetime_redeemed_points ?? 0),
      enrolledAt: String(row.enrolled_at ?? ""),
    }));
  } catch {
    return [];
  }
}

/** Ledger history for one account, newest first (RLS limits to own shop). */
export async function fetchAccountHistory(
  shopId: string,
  accountId: string,
  limit = 50,
): Promise<LoyaltyTransactionRow[]> {
  if (!hasSupabaseConfig || !supabase || !shopId || !accountId) return [];
  try {
    const { data, error } = await supabase
      .from("loyalty_transactions")
      .select(
        "id, account_id, kind, points, balance_after, cause, source_sale_id, source_return_id, source_void_id, reversal_of_id, note, created_at",
      )
      .eq("shop_id", shopId)
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) return [];
    return data.map((row) => ({
      id: row.id as string,
      shopId,
      accountId: row.account_id as string,
      kind: row.kind as LoyaltyTransactionKind,
      points: Number(row.points ?? 0),
      balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
      cause: row.cause as LoyaltyTransactionRow["cause"],
      sourceSaleId: (row.source_sale_id as string | null) ?? null,
      sourceReturnId: (row.source_return_id as string | null) ?? null,
      sourceVoidId: (row.source_void_id as string | null) ?? null,
      reversalOfId: (row.reversal_of_id as string | null) ?? null,
      note: (row.note as string | null) ?? null,
      createdAt: row.created_at as string,
    }));
  } catch {
    return [];
  }
}

export type AdjustResult = { ok: true } | { ok: false; error: string };

/** Manual balance correction (manager-only; authorized again inside the RPC). */
export async function adjustLoyaltyPoints(
  accountId: string,
  points: number,
  note: string,
): Promise<AdjustResult> {
  if (!hasSupabaseConfig || !supabase || !accountId) return { ok: false, error: "loyalty_unavailable" };
  if (!Number.isInteger(points) || points === 0) return { ok: false, error: "invalid_points" };
  if (!note.trim()) return { ok: false, error: "note_required" };
  try {
    const { data, error } = await supabase.rpc("loyalty_adjust_points", {
      p_account_id: accountId,
      p_points: points,
      p_note: note.trim(),
    });
    if (error) return { ok: false, error: error.code ?? "loyalty_adjust_failed" };
    const result = (data ?? {}) as { ok?: boolean; error?: string };
    if (!result.ok) return { ok: false, error: result.error ?? "loyalty_adjust_rejected" };
    return { ok: true };
  } catch {
    return { ok: false, error: "loyalty_adjust_failed" };
  }
}
