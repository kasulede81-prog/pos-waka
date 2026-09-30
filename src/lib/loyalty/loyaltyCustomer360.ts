/**
 * Customer 360 data layer (Phase C) — MERCHANT-side.
 *
 * NO SECOND SOURCE OF TRUTH. Every number these functions return is derived on the server
 * from the authoritative tables (`sales`, `sale_returns`, `loyalty_accounts`,
 * `loyalty_transactions`, `loyalty_redemptions`) at read time. Nothing is cached here, and
 * nothing is written: both RPCs are `stable`.
 *
 * SPENDING IS READ, NOT COMPUTED CLIENT-SIDE. The server reports gross, refunds and net,
 * because the rule that matters — a returned sale keeps `status='completed'` and its
 * refund sits beside it in `sale_returns` — is a server-side fact this layer must not
 * re-derive. `averagePurchaseUgx` is the server's own derived statistic, labelled as such
 * wherever it is shown.
 *
 * AUTHORIZATION IS THE SHOP, NOT THE SESSION. These are merchant reads: the server
 * requires `user_can_access_shop` for the shop and that the customer belongs to it. A
 * `forbidden` result means the caller has no access to that shop; `not_found` means the
 * customer is not that shop's.
 */

import { supabase } from "../supabase";

export type ShopCustomerSummary = {
  id: string;
  name: string;
  phoneE164: string | null;
  hasLoyaltyAccount: boolean;
  balancePoints: number | null;
  accountStatus: string | null;
};

export type Customer360Loyalty = {
  hasAccount: boolean;
  accountStatus: string;
  memberSince: string | null;
  membershipExpiresAt: string | null;
  membershipActive: boolean;
  balancePoints: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
  memberLinkStatus: string | null;
};

export type Customer360Reward = {
  id: string;
  name: string;
  pointsRequired: number;
  rewardKind: string;
  personal: boolean;
  active: boolean;
  expiresOn: string | null;
  timesRedeemed: number;
  maxRedemptionsPerAccount: number | null;
  redemptionsRemaining: number | null;
  /** available | insufficient_points | limit_reached | expired | inactive */
  state: string;
};

export type Customer360 = {
  customer: {
    id: string;
    name: string;
    phoneE164: string | null;
    email: string | null;
    customerSince: string | null;
  };
  /** null when the customer has no loyalty account — a real state, not an error. */
  loyalty: Customer360Loyalty | null;
  spending: {
    completedPurchases: number;
    grossSpendUgx: number;
    returnedUgx: number;
    netSpendUgx: number;
    /** Server-derived: net spend over completed purchases. Not an authoritative figure. */
    averagePurchaseUgx: number | null;
    voidedPurchases: number;
    firstPurchaseAt: string | null;
    lastPurchaseAt: string | null;
  };
  rewards: {
    items: Customer360Reward[];
    truncated: boolean;
    redemptionCount: number;
    pointsRedeemed: number;
  };
  recentPurchases: { totalUgx: number; returnedUgx: number; completedAt: string; paymentStatus: string }[];
  recentLoyaltyActivity: { kind: string; cause: string; points: number; balanceAfter: number | null; createdAt: string }[];
  recentRedemptions: {
    id: string;
    rewardName: string;
    pointsSpent: number;
    status: string;
    redeemedAt: string;
    /** Phase E — the benefit this redemption was worth, from its own snapshot. */
    benefitKind: string;
    benefitAmountUgx: number | null;
    benefitPercent: number | null;
    /** What a sale actually received, null when the benefit was never applied. */
    appliedAmountUgx: number | null;
  }[];
};

export type Customer360Result =
  | { ok: true; data: Customer360 }
  /** forbidden = no access to the shop; not_found = not this shop's customer. */
  | { ok: false; error: "forbidden" | "not_found" | "offline" | "unavailable" | string };

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

/** Search this shop's own customers. Loyalty membership is a flag, not a filter. */
export async function searchShopCustomers(
  shopId: string,
  query: string,
  limit = 25,
): Promise<{ ok: true; customers: ShopCustomerSummary[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  try {
    const { data, error } = await supabase.rpc("shop_customer_search", {
      p_shop_id: shopId,
      p_query: query.trim() || null,
      p_limit: limit,
    });
    if (error) return { ok: false, error: "unavailable" };
    const raw = (data ?? {}) as Record<string, unknown>;
    if (raw.ok !== true) return { ok: false, error: String(raw.error ?? "unavailable") };
    const list = Array.isArray(raw.customers) ? (raw.customers as Record<string, unknown>[]) : [];
    return {
      ok: true,
      customers: list.map((row) => ({
        id: String(row.id ?? ""),
        name: String(row.name ?? ""),
        phoneE164: str(row.phone_e164),
        hasLoyaltyAccount: row.has_loyalty_account === true,
        balancePoints: row.balance_points == null ? null : num(row.balance_points),
        accountStatus: str(row.account_status),
      })),
    };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** The Customer 360 profile for one customer of one shop. */
export async function fetchCustomer360(
  shopId: string,
  customerId: string,
  activityLimit = 10,
): Promise<Customer360Result> {
  if (!supabase) return { ok: false, error: "offline" };
  try {
    const { data, error } = await supabase.rpc("shop_customer_360", {
      p_shop_id: shopId,
      p_customer_id: customerId,
      p_activity_limit: activityLimit,
    });
    if (error) return { ok: false, error: "unavailable" };
    const raw = (data ?? {}) as Record<string, unknown>;
    if (raw.ok !== true) return { ok: false, error: String(raw.error ?? "unavailable") };

    const c = (raw.customer ?? {}) as Record<string, unknown>;
    const l = raw.loyalty == null ? null : (raw.loyalty as Record<string, unknown>);
    const s = (raw.spending ?? {}) as Record<string, unknown>;
    const r = (raw.rewards ?? {}) as Record<string, unknown>;

    const rewards = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
    const purchases = Array.isArray(raw.recent_purchases) ? (raw.recent_purchases as Record<string, unknown>[]) : [];
    const activity = Array.isArray(raw.recent_loyalty_activity)
      ? (raw.recent_loyalty_activity as Record<string, unknown>[])
      : [];
    const redemptions = Array.isArray(raw.recent_redemptions)
      ? (raw.recent_redemptions as Record<string, unknown>[])
      : [];

    return {
      ok: true,
      data: {
        customer: {
          id: String(c.id ?? ""),
          name: String(c.name ?? ""),
          phoneE164: str(c.phone_e164),
          email: str(c.email),
          customerSince: str(c.customer_since),
        },
        loyalty: l
          ? {
              hasAccount: true,
              accountStatus: String(l.account_status ?? ""),
              memberSince: str(l.member_since),
              membershipExpiresAt: str(l.membership_expires_at),
              membershipActive: l.membership_active === true,
              balancePoints: num(l.balance_points),
              lifetimeEarnedPoints: num(l.lifetime_earned_points),
              lifetimeRedeemedPoints: num(l.lifetime_redeemed_points),
              memberLinkStatus: str(l.member_link_status),
            }
          : null,
        spending: {
          completedPurchases: num(s.completed_purchases),
          grossSpendUgx: num(s.gross_spend_ugx),
          returnedUgx: num(s.returned_ugx),
          netSpendUgx: num(s.net_spend_ugx),
          averagePurchaseUgx: s.average_purchase_ugx == null ? null : num(s.average_purchase_ugx),
          voidedPurchases: num(s.voided_purchases),
          firstPurchaseAt: str(s.first_purchase_at),
          lastPurchaseAt: str(s.last_purchase_at),
        },
        rewards: {
          items: rewards.map((rw) => ({
            id: String(rw.id ?? ""),
            name: String(rw.name ?? ""),
            pointsRequired: num(rw.points_required),
            rewardKind: String(rw.reward_kind ?? "custom"),
            personal: rw.personal === true,
            active: rw.active !== false,
            expiresOn: str(rw.expires_on),
            timesRedeemed: num(rw.times_redeemed),
            maxRedemptionsPerAccount:
              rw.max_redemptions_per_account == null ? null : num(rw.max_redemptions_per_account),
            redemptionsRemaining: rw.redemptions_remaining == null ? null : num(rw.redemptions_remaining),
            state: String(rw.state ?? "unavailable"),
          })),
          truncated: r.truncated === true,
          redemptionCount: num(r.redemption_count),
          pointsRedeemed: num(r.points_redeemed),
        },
        recentPurchases: purchases.map((p) => ({
          totalUgx: num(p.total_ugx),
          returnedUgx: num(p.returned_ugx),
          completedAt: String(p.completed_at ?? ""),
          paymentStatus: String(p.payment_status ?? ""),
        })),
        recentLoyaltyActivity: activity.map((a) => ({
          kind: String(a.kind ?? ""),
          cause: String(a.cause ?? ""),
          points: num(a.points),
          balanceAfter: a.balance_after == null ? null : num(a.balance_after),
          createdAt: String(a.created_at ?? ""),
        })),
        recentRedemptions: redemptions.map((d) => ({
          id: String(d.id ?? ""),
          rewardName: String(d.reward_name ?? ""),
          pointsSpent: num(d.points_spent),
          status: String(d.status ?? ""),
          redeemedAt: String(d.redeemed_at ?? ""),
          benefitKind: String(d.benefit_kind ?? "none"),
          benefitAmountUgx: d.benefit_amount_ugx == null ? null : num(d.benefit_amount_ugx),
          benefitPercent: d.benefit_percent == null ? null : num(d.benefit_percent),
          appliedAmountUgx: d.applied_amount_ugx == null ? null : num(d.applied_amount_ugx),
        })),
      },
    };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
