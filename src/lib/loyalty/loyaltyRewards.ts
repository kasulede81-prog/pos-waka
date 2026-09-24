/**
 * Loyalty rewards & redemption client (Phase 08 + C2 expiry).
 *
 * Rewards are merchant-defined catalog rows (RLS: managers write, any shop
 * member reads). Redemptions go through `loyalty_redeem_reward` — atomic,
 * idempotent (client generates one idempotency key per redemption intent),
 * and auditable via the immutable ledger. Authorization is enforced in the
 * RPC (`user_can_redeem_loyalty`); the UI gates on `loyalty.redeem`.
 * Points are NEVER modified here.
 */

import { hasSupabaseConfig, supabase } from "../supabase";

export type LoyaltyReward = {
  id: string;
  name: string;
  description: string;
  pointsRequired: number;
  rewardKind: "product" | "voucher" | "custom";
  productId: string | null;
  maxRedemptionsPerAccount: number | null;
  active: boolean;
  sortOrder: number;
  /** Inclusive Kampala end date YYYY-MM-DD, or null = never expires. */
  expiresOn: string | null;
};

export type RewardInput = {
  name: string;
  description: string;
  pointsRequired: number;
  rewardKind: "product" | "voucher" | "custom";
  productId: string | null;
  maxRedemptionsPerAccount: number | null;
  active: boolean;
  /** null = never expires; YYYY-MM-DD when set. */
  expiresOn: string | null;
};

type RewardRow = {
  id: string;
  name: string;
  description: string;
  points_required: number;
  reward_kind: string;
  product_id: string | null;
  max_redemptions_per_account: number | null;
  active: boolean;
  sort_order: number;
  expires_on?: string | null;
};

function mapExpiresOn(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  return String(raw).slice(0, 10);
}

function mapRewardRow(row: RewardRow): LoyaltyReward {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    pointsRequired: Number(row.points_required),
    rewardKind: (["product", "voucher", "custom"].includes(row.reward_kind)
      ? row.reward_kind
      : "custom") as LoyaltyReward["rewardKind"],
    productId: row.product_id,
    maxRedemptionsPerAccount:
      row.max_redemptions_per_account == null ? null : Number(row.max_redemptions_per_account),
    active: row.active,
    sortOrder: Number(row.sort_order ?? 0),
    expiresOn: mapExpiresOn(row.expires_on),
  };
}

export function validateRewardInput(input: RewardInput): string | null {
  if (!input.name.trim()) return "name_required";
  if (!Number.isInteger(input.pointsRequired) || input.pointsRequired <= 0)
    return "invalid_points_required";
  if (
    input.maxRedemptionsPerAccount != null &&
    (!Number.isInteger(input.maxRedemptionsPerAccount) || input.maxRedemptionsPerAccount <= 0)
  ) {
    return "invalid_max_redemptions";
  }
  if (input.expiresOn != null && input.expiresOn !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn.trim())) return "invalid_reward_expires_on";
  }
  return null;
}

/**
 * Client-side mirror of Kampala inclusive end-of-day (display / Hub only).
 * Server `now()` remains authoritative for redemption.
 */
export function isRewardUnexpiredClient(
  expiresOn: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (expiresOn == null || String(expiresOn).trim() === "") return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiresOn).trim().slice(0, 10));
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Exclusive upper bound = next Kampala calendar day 00:00 (UTC+3, no DST).
  const exclusiveUtcMs = Date.UTC(y, mo - 1, d + 1) - 3 * 60 * 60 * 1000;
  return nowMs < exclusiveUtcMs;
}

/** A customer can redeem when active, unexpired, and balance covers cost. */
export function isRewardEligible(reward: LoyaltyReward, balancePoints: number): boolean {
  return (
    reward.active &&
    isRewardUnexpiredClient(reward.expiresOn) &&
    balancePoints >= reward.pointsRequired
  );
}

const REWARD_COLUMNS =
  "id, name, description, points_required, reward_kind, product_id, max_redemptions_per_account, active, sort_order, expires_on";

export async function fetchLoyaltyRewards(shopId: string): Promise<LoyaltyReward[]> {
  if (!hasSupabaseConfig || !supabase || !shopId) return [];
  try {
    const { data, error } = await supabase
      .from("loyalty_rewards")
      .select(REWARD_COLUMNS)
      .eq("shop_id", shopId)
      .order("sort_order")
      .order("name");
    if (error || !Array.isArray(data)) return [];
    return (data as RewardRow[]).map(mapRewardRow);
  } catch {
    return [];
  }
}

export type RewardSaveResult = { ok: true; rewardId: string } | { ok: false; error: string };

export async function createLoyaltyReward(shopId: string, input: RewardInput): Promise<RewardSaveResult> {
  const invalid = validateRewardInput(input);
  if (invalid) return { ok: false, error: invalid };
  if (!hasSupabaseConfig || !supabase || !shopId) return { ok: false, error: "loyalty_unavailable" };
  try {
    const expiresOn =
      input.expiresOn == null || input.expiresOn.trim() === "" ? null : input.expiresOn.trim().slice(0, 10);
    const { data, error } = await supabase
      .from("loyalty_rewards")
      .insert({
        shop_id: shopId,
        name: input.name.trim(),
        description: input.description.trim(),
        points_required: input.pointsRequired,
        reward_kind: input.rewardKind,
        product_id: input.productId,
        max_redemptions_per_account: input.maxRedemptionsPerAccount,
        active: input.active,
        expires_on: expiresOn,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.code ?? "reward_create_failed" };
    return { ok: true, rewardId: (data as { id: string }).id };
  } catch {
    return { ok: false, error: "reward_create_failed" };
  }
}

export async function updateLoyaltyReward(
  rewardId: string,
  patch: Partial<RewardInput>,
): Promise<RewardSaveResult> {
  if (!hasSupabaseConfig || !supabase || !rewardId) return { ok: false, error: "loyalty_unavailable" };
  try {
    const { data, error } = await supabase
      .from("loyalty_rewards")
      .update({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.pointsRequired !== undefined ? { points_required: patch.pointsRequired } : {}),
        ...(patch.rewardKind !== undefined ? { reward_kind: patch.rewardKind } : {}),
        ...(patch.productId !== undefined ? { product_id: patch.productId } : {}),
        ...(patch.maxRedemptionsPerAccount !== undefined
          ? { max_redemptions_per_account: patch.maxRedemptionsPerAccount }
          : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.expiresOn !== undefined
          ? {
              expires_on:
                patch.expiresOn == null || patch.expiresOn.trim() === ""
                  ? null
                  : patch.expiresOn.trim().slice(0, 10),
            }
          : {}),
      })
      .eq("id", rewardId)
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.code ?? "reward_update_failed" };
    return { ok: true, rewardId: (data as { id: string }).id };
  } catch {
    return { ok: false, error: "reward_update_failed" };
  }
}

export type RedeemResult =
  | {
      ok: true;
      redemptionId: string;
      alreadyRedeemed: boolean;
      pointsSpent: number;
      balance: number;
    }
  | { ok: false; error: string; balance?: number; required?: number };

/**
 * Redeems a reward for an account. `idempotencyKey` must be generated once
 * per user intent (UI: on confirm) and reused on retries so repeated
 * taps/clicks/network replays return the original redemption instead of
 * deducting twice.
 */
export async function redeemLoyaltyReward(
  shopId: string,
  accountId: string,
  rewardId: string,
  idempotencyKey: string,
  note?: string,
): Promise<RedeemResult> {
  if (!hasSupabaseConfig || !supabase || !shopId || !accountId || !rewardId) {
    return { ok: false, error: "loyalty_unavailable" };
  }
  if (!idempotencyKey.trim()) return { ok: false, error: "idempotency_key_required" };
  try {
    const { data, error } = await supabase.rpc("loyalty_redeem_reward", {
      p_shop_id: shopId,
      p_account_id: accountId,
      p_reward_id: rewardId,
      p_idempotency_key: idempotencyKey,
      p_note: note ?? null,
      p_sale_id: null,
    });
    if (error) return { ok: false, error: error.code ?? "redeem_failed" };
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) {
      return {
        ok: false,
        error: String(result.error ?? "redeem_rejected"),
        balance: result.balance == null ? undefined : Number(result.balance),
        required: result.required == null ? undefined : Number(result.required),
      };
    }
    return {
      ok: true,
      redemptionId: String(result.redemption_id),
      alreadyRedeemed: Boolean(result.already_redeemed),
      pointsSpent: Number(result.points_spent ?? 0),
      balance: Number(result.balance ?? 0),
    };
  } catch {
    return { ok: false, error: "redeem_failed" };
  }
}

/** New idempotency key for a fresh redemption intent. */
export function newRedemptionIdempotencyKey(): string {
  return crypto.randomUUID();
}
