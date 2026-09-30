/**
 * Member Dashboard data layer (Phase 1).
 *
 * Read-only by construction: the only reads go through `loyalty_member_dashboard()`, a SECURITY
 * DEFINER projection that takes NO parameters and resolves the member from `auth.uid()` alone.
 * There is no member id in any request, so cross-member access is structurally impossible rather
 * than merely checked — and the browser never touches `loyalty_accounts` or `loyalty_member_links`
 * directly (both are revoked from `authenticated`; the links table has no browser read path at
 * all).
 *
 * The projection deliberately never returns `qr_token` or `public_card_token`. Both are bearer
 * credentials, and `public_card_token` IS the public card URL — the card face shows only whether
 * a public card exists.
 */

import { hasSupabaseConfig, supabase } from "./supabase";

export type MemberIdentity = {
  id: string;
  displayName: string | null;
  phoneMasked: string | null;
  email: string | null;
  status: string;
  memberSince: string | null;
  phoneVerified: boolean;
};

export type MemberLinkedAccount = {
  linkId: string;
  shopId: string;
  shopName: string;
  shopBusinessType: string | null;
  shopDistrict: string | null;
  accountStatus: string;
  balancePoints: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
  membershipExpiresAt: string | null;
  enrolledAt: string | null;
  hasPublicCard: boolean;
};

export type MemberDashboard = {
  member: MemberIdentity;
  accounts: MemberLinkedAccount[];
  counts: {
    linkedAccounts: number;
    activeAccounts: number;
    suspendedAccounts: number;
  };
};

/**
 * One row of the member's own points activity (Phase A).
 *
 * `id` is the ledger row's id and travels only because keyset pagination needs a
 * tie-breaker — timestamps can collide, and OFFSET would duplicate and skip rows on a
 * ledger that keeps growing. It authorises nothing: no read path in the schema takes a
 * transaction id.
 */
export type MemberActivityItem = {
  id: string;
  /** earned | redeemed | reversed | expired | adjusted | promotional */
  kind: string;
  /** sale | return | void | redemption | expiration | manual_adjustment | promotion | enrollment */
  cause: string;
  points: number;
  balanceAfter: number | null;
  createdAt: string;
  shopId: string;
  shopName: string;
  /** The member's own purchase total, joined from the authoritative `sales` row. */
  saleTotalUgx: number | null;
  rewardName: string | null;
  rewardPointsRequired: number | null;
};

export type MemberActivityPage = {
  items: MemberActivityItem[];
  hasMore: boolean;
  /** Keyset cursor for the next page (exclusive); null when the history is exhausted. */
  nextBefore: string | null;
  nextBeforeId: string | null;
};

/**
 * A reward as the member may see it (Phase B).
 *
 * `state` is computed by the SERVER and only rendered here. The client never decides
 * whether a reward is redeemable — the same canonical helpers the redemption path uses
 * (`loyalty_account_reward_granted`, `loyalty_reward_unexpired`) decide it, and the same
 * redemption-limit predicate. `balancePoints` is that merchant's authoritative account
 * balance, not a figure derived from this list.
 *
 * There is no monetary value field because the schema has none yet.
 */
export type MemberReward = {
  id: string;
  shopId: string;
  shopName: string;
  name: string;
  description: string;
  /** product | voucher | custom — as stored. */
  rewardKind: string;
  /**
   * What the reward is worth: none | fixed_discount | percentage_discount.
   *
   * A discount benefit is applied to a WAKA sale at the counter. It is NOT stored value and
   * nothing converts points to money — the member is told what their points buy, not given
   * a balance.
   */
  benefitKind: string;
  /** Integer UGX when benefitKind is fixed_discount. */
  benefitAmountUgx: number | null;
  /** 0–100 when benefitKind is percentage_discount. */
  benefitPercent: number | null;
  pointsRequired: number;
  balancePoints: number;
  pointsNeeded: number;
  /** True when the reward was granted to this member specifically (D029/D026). */
  personal: boolean;
  /** When a personal grant lapses, if it is time-limited. */
  grantedUntil: string | null;
  expiresOn: string | null;
  active: boolean;
  maxRedemptionsPerAccount: number | null;
  timesRedeemed: number;
  redemptionsRemaining: number | null;
  /** available | insufficient_points | limit_reached | expired | inactive */
  state: string;
};

export type MemberRewardsPage = {
  rewards: MemberReward[];
  /** True when the list was cut short by the page bound. */
  truncated: boolean;
};

/**
 * A promotion running for this member (Phase G).
 *
 * A DISPLAY OF THE SERVER'S PROJECTION, never a computation. `qualifyingSpendUgx`,
 * `remainingUgx` and `rewarded` are all decided server-side from authoritative sales; the
 * progress bar renders those numbers and nothing here decides eligibility.
 */
export type MemberPromotion = {
  shopId: string;
  shopName: string;
  title: string;
  /** earn_bonus_flat | earn_multiplier | reward_grant | spend_bonus */
  kind: string;
  bonusPoints: number | null;
  multiplier: number | null;
  grantedRewardCount: number | null;
  /** Spend-threshold promotions only. */
  thresholdUgx: number | null;
  qualifyingSpendUgx: number | null;
  remainingUgx: number | null;
  endsAt: string | null;
  /** True once the server has actually awarded it. */
  rewarded: boolean;
};

export type MemberResult<T> = { ok: true; data: T } | { ok: false; error: string };

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  map: (raw: Record<string, unknown>) => T,
): Promise<MemberResult<T>> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "offline" };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, error: "forbidden" };
    const raw = (data ?? {}) as Record<string, unknown>;
    if (raw.ok !== true) return { ok: false, error: String(raw.error ?? "unavailable") };
    return { ok: true, data: map(raw) };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * The member's own points activity, newest first.
 *
 * No member/account/shop parameter exists to pass — the server resolves the caller from
 * `auth.uid()` alone, so this can only ever return the signed-in member's own rows. The
 * only arguments are a page size and the previous page's cursor.
 */
export async function fetchMemberActivity(
  cursor?: { before: string | null; beforeId: string | null },
  limit = 20,
): Promise<MemberResult<MemberActivityPage>> {
  return callRpc(
    "loyalty_member_activity",
    { p_limit: limit, p_before: cursor?.before ?? null, p_before_id: cursor?.beforeId ?? null },
    (raw) => {
      const list = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : [];
      const items: MemberActivityItem[] = list.map((entry) => {
        const shop = (entry.shop ?? {}) as Record<string, unknown>;
        return {
          id: String(entry.id ?? ""),
          kind: String(entry.kind ?? ""),
          cause: String(entry.cause ?? ""),
          points: num(entry.points),
          balanceAfter: entry.balance_after == null ? null : num(entry.balance_after),
          createdAt: String(entry.created_at ?? ""),
          shopId: String(shop.id ?? ""),
          shopName: String(shop.name ?? ""),
          saleTotalUgx: entry.sale_total_ugx == null ? null : num(entry.sale_total_ugx),
          rewardName: str(entry.reward_name),
          rewardPointsRequired:
            entry.reward_points_required == null ? null : num(entry.reward_points_required),
        };
      });
      return {
        items,
        hasMore: raw.has_more === true,
        nextBefore: str(raw.next_before),
        nextBeforeId: str(raw.next_before_id),
      };
    },
  );
}

/**
 * The rewards this member may have, across every merchant they are linked to.
 *
 * No member/account/shop argument exists to pass — the server resolves the caller from
 * `auth.uid()` alone. Read-only: redemption is merchant-driven today, so there is
 * deliberately nothing here that spends points.
 */
export async function fetchMemberRewards(limit = 100): Promise<MemberResult<MemberRewardsPage>> {
  return callRpc("loyalty_member_rewards", { p_limit: limit }, (raw) => {
    const list = Array.isArray(raw.rewards) ? (raw.rewards as Record<string, unknown>[]) : [];
    const rewards: MemberReward[] = list.map((entry) => {
      const shop = (entry.shop ?? {}) as Record<string, unknown>;
      return {
        id: String(entry.id ?? ""),
        shopId: String(shop.id ?? ""),
        shopName: String(shop.name ?? ""),
        name: String(entry.name ?? ""),
        description: str(entry.description) ?? "",
        rewardKind: String(entry.reward_kind ?? "custom"),
        benefitKind: String(entry.benefit_kind ?? "none"),
        benefitAmountUgx: entry.benefit_amount_ugx == null ? null : num(entry.benefit_amount_ugx),
        benefitPercent: entry.benefit_percent == null ? null : num(entry.benefit_percent),
        pointsRequired: num(entry.points_required),
        balancePoints: num(entry.balance_points),
        pointsNeeded: num(entry.points_needed),
        personal: entry.personal === true,
        grantedUntil: str(entry.granted_until),
        expiresOn: str(entry.expires_on),
        active: entry.active !== false,
        maxRedemptionsPerAccount:
          entry.max_redemptions_per_account == null ? null : num(entry.max_redemptions_per_account),
        timesRedeemed: num(entry.times_redeemed),
        redemptionsRemaining:
          entry.redemptions_remaining == null ? null : num(entry.redemptions_remaining),
        state: String(entry.state ?? "unavailable"),
      };
    });
    return { rewards, truncated: raw.truncated === true };
  });
}

/**
 * The promotions running for this member. Read-only, resolved from `auth.uid()` with no
 * identity parameters — the same shape as the other member projections.
 */
export async function fetchMemberPromotions(): Promise<MemberResult<MemberPromotion[]>> {
  return callRpc("loyalty_member_promotions", {}, (raw) => {
    const list = Array.isArray(raw.promotions) ? (raw.promotions as Record<string, unknown>[]) : [];
    return list.map((entry) => {
      const shop = (entry.shop ?? {}) as Record<string, unknown>;
      return {
        shopId: String(shop.id ?? ""),
        shopName: String(shop.name ?? ""),
        title: String(entry.title ?? ""),
        kind: String(entry.kind ?? ""),
        bonusPoints: entry.bonus_points == null ? null : num(entry.bonus_points),
        multiplier: entry.multiplier == null ? null : num(entry.multiplier),
        grantedRewardCount: entry.granted_reward_count == null ? null : num(entry.granted_reward_count),
        thresholdUgx: entry.threshold_ugx == null ? null : num(entry.threshold_ugx),
        qualifyingSpendUgx: entry.qualifying_spend_ugx == null ? null : num(entry.qualifying_spend_ugx),
        remainingUgx: entry.remaining_ugx == null ? null : num(entry.remaining_ugx),
        endsAt: str(entry.ends_at),
        rewarded: entry.rewarded === true,
      };
    });
  });
}

export async function fetchMemberDashboard(): Promise<MemberResult<MemberDashboard>> {
  return callRpc("loyalty_member_dashboard", {}, (raw) => {
    const m = (raw.member ?? {}) as Record<string, unknown>;
    const list = Array.isArray(raw.accounts) ? (raw.accounts as Record<string, unknown>[]) : [];
    const c = (raw.counts ?? {}) as Record<string, unknown>;

    const accounts: MemberLinkedAccount[] = list.map((entry) => {
      const shop = (entry.shop ?? {}) as Record<string, unknown>;
      const account = (entry.account ?? {}) as Record<string, unknown>;
      const card = (entry.card ?? {}) as Record<string, unknown>;
      return {
        linkId: String(entry.link_id ?? ""),
        shopId: String(shop.id ?? ""),
        shopName: String(shop.name ?? ""),
        shopBusinessType: str(shop.business_type),
        shopDistrict: str(shop.district),
        accountStatus: String(account.status ?? "active"),
        balancePoints: num(account.balance_points),
        lifetimeEarnedPoints: num(account.lifetime_earned_points),
        lifetimeRedeemedPoints: num(account.lifetime_redeemed_points),
        membershipExpiresAt: str(account.membership_expires_at),
        enrolledAt: str(account.enrolled_at),
        hasPublicCard: card.has_public_card === true,
      };
    });

    return {
      member: {
        id: String(m.id ?? ""),
        displayName: str(m.display_name),
        phoneMasked: str(m.phone_e164_masked),
        email: str(m.email),
        status: String(m.status ?? "active"),
        memberSince: str(m.member_since),
        phoneVerified: m.phone_verified === true,
      },
      accounts,
      counts: {
        linkedAccounts: num(c.linked_accounts),
        activeAccounts: num(c.active_accounts),
        suspendedAccounts: num(c.suspended_accounts),
      },
    };
  });
}

/**
 * Materialize (or refresh) the caller's member row. Idempotent, and touches nothing but
 * `loyalty_members` — registering as a member must never create a tenancy.
 */
export async function registerLoyaltyMember(
  displayName: string | null,
  phoneE164: string | null,
): Promise<MemberResult<{ memberId: string; status: string; created: boolean }>> {
  return callRpc(
    "loyalty_member_register",
    { p_display_name: displayName, p_phone_e164: phoneE164 },
    (raw) => ({
      memberId: String(raw.member_id ?? ""),
      status: String(raw.status ?? "active"),
      created: raw.created === true,
    }),
  );
}

/**
 * Ask to link an account whose card the caller already holds. Phase 1 NEVER links automatically —
 * this always returns a pending request for merchant review, even on an exact phone match.
 */
export async function startMemberClaim(
  shopId: string,
  cardToken: string,
): Promise<MemberResult<{ requestId: string; status: string; alreadyRequested: boolean }>> {
  return callRpc(
    "loyalty_member_claim_start",
    { p_shop_id: shopId, p_card_token: cardToken },
    (raw) => ({
      requestId: String(raw.request_id ?? ""),
      status: String(raw.status ?? "pending"),
      alreadyRequested: raw.already_requested === true,
    }),
  );
}
