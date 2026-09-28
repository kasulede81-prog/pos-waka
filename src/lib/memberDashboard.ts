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
