/**
 * Spend-threshold promotions, merchant side (Phase G).
 *
 * Writes go straight to `loyalty_spend_promotions` under RLS (`user_can_manage_shop`), the
 * same pattern the reward catalogue uses — the table is the authority, and the column CHECKs
 * reject a bad threshold, bonus or window whatever the form does. The AWARD is never driven
 * from here: `loyalty_apply_spend_promotions` runs on the sale's completion transition,
 * reading authoritative sales. Nothing in this file can pay a customer.
 */

import { supabase } from "../supabase";

export type SpendPromotion = {
  id: string;
  /** null = shop-wide. */
  accountId: string | null;
  title: string;
  thresholdUgx: number;
  bonusPoints: number;
  maxAwards: number;
  startsAt: string | null;
  endsAt: string | null;
  status: "active" | "paused" | "revoked";
};

export type SpendPromotionInput = {
  title: string;
  thresholdUgx: number;
  bonusPoints: number;
  maxAwards: number;
  startsAt: string | null;
  endsAt: string | null;
  status: "active" | "paused" | "revoked";
  /** null = shop-wide. */
  accountId: string | null;
};

const COLUMNS =
  "id, account_id, title, threshold_ugx, bonus_points, max_awards, starts_at, ends_at, status";

type Row = {
  id: string;
  account_id: string | null;
  title: string;
  threshold_ugx: number;
  bonus_points: number;
  max_awards: number;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
};

function mapRow(row: Row): SpendPromotion {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    thresholdUgx: Number(row.threshold_ugx),
    bonusPoints: Number(row.bonus_points),
    maxAwards: Number(row.max_awards),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: (["active", "paused", "revoked"].includes(row.status)
      ? row.status
      : "paused") as SpendPromotion["status"],
  };
}

/** Client-side guard for UX only — the database CHECKs are authoritative. */
export function validateSpendPromotionInput(input: SpendPromotionInput): string | null {
  if (!input.title.trim()) return "title_required";
  if (!Number.isInteger(input.thresholdUgx) || input.thresholdUgx <= 0) return "invalid_threshold";
  if (!Number.isInteger(input.bonusPoints) || input.bonusPoints <= 0) return "invalid_bonus_points";
  if (!Number.isInteger(input.maxAwards) || input.maxAwards <= 0) return "invalid_max_awards";
  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
    return "invalid_window";
  }
  return null;
}

export async function fetchSpendPromotions(shopId: string): Promise<SpendPromotion[]> {
  if (!supabase || !shopId) return [];
  try {
    const { data, error } = await supabase
      .from("loyalty_spend_promotions")
      .select(COLUMNS)
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false });
    if (error || !Array.isArray(data)) return [];
    return (data as Row[]).map(mapRow);
  } catch {
    return [];
  }
}

type SaveResult = { ok: true; id: string } | { ok: false; error: string };

export async function createSpendPromotion(
  shopId: string,
  input: SpendPromotionInput,
): Promise<SaveResult> {
  const invalid = validateSpendPromotionInput(input);
  if (invalid) return { ok: false, error: invalid };
  if (!supabase || !shopId) return { ok: false, error: "loyalty_unavailable" };
  try {
    const { data, error } = await supabase
      .from("loyalty_spend_promotions")
      .insert({
        shop_id: shopId,
        account_id: input.accountId,
        title: input.title.trim().slice(0, 80),
        threshold_ugx: input.thresholdUgx,
        bonus_points: input.bonusPoints,
        max_awards: input.maxAwards,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        status: input.status,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.code ?? "promotion_create_failed" };
    return { ok: true, id: (data as { id: string }).id };
  } catch {
    return { ok: false, error: "promotion_create_failed" };
  }
}

/**
 * Update a promotion. Only FUTURE awards are affected: an award already in the ledger carries
 * its own snapshot and is never recalculated from this row.
 */
export async function updateSpendPromotion(
  promotionId: string,
  patch: Partial<SpendPromotionInput>,
): Promise<SaveResult> {
  if (!supabase || !promotionId) return { ok: false, error: "loyalty_unavailable" };
  try {
    const { data, error } = await supabase
      .from("loyalty_spend_promotions")
      .update({
        ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 80) } : {}),
        ...(patch.thresholdUgx !== undefined ? { threshold_ugx: patch.thresholdUgx } : {}),
        ...(patch.bonusPoints !== undefined ? { bonus_points: patch.bonusPoints } : {}),
        ...(patch.maxAwards !== undefined ? { max_awards: patch.maxAwards } : {}),
        ...(patch.startsAt !== undefined ? { starts_at: patch.startsAt } : {}),
        ...(patch.endsAt !== undefined ? { ends_at: patch.endsAt } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.accountId !== undefined ? { account_id: patch.accountId } : {}),
      })
      .eq("id", promotionId)
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.code ?? "promotion_update_failed" };
    return { ok: true, id: (data as { id: string }).id };
  } catch {
    return { ok: false, error: "promotion_update_failed" };
  }
}
