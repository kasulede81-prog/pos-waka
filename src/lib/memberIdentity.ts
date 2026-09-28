/**
 * Member identity classification (Phase 1).
 *
 * Server state decides who someone is; this module only relays that answer and decides which
 * bootstrap path a session should take. The authority is `public.waka_account_identity()`, a
 * `stable` SECURITY DEFINER read that writes nothing.
 *
 * THE FAILURE DIRECTION IS THE WHOLE POINT. The bug this phase removes is an authenticated user
 * being silently turned into the owner of a new shop. So an error must never fall through to the
 * merchant branch: if the classifier cannot be reached, only an explicit, locally-readable
 * merchant intent keeps the merchant path, and everything else resolves to `unknown` — which
 * bootstraps nothing.
 *
 * Classification is per session, cached by user id, and reset on sign-out.
 */

import { hasSupabaseConfig, supabase } from "./supabase";

export type AccountIdentity = {
  authUserId: string;
  isMember: boolean;
  memberId: string | null;
  memberStatus: string | null;
  isShopMember: boolean;
  shopId: string | null;
  membershipRole: string | null;
  isOrgMember: boolean;
  organizationId: string | null;
  hasPendingStaffInvite: boolean;
  merchantIntent: boolean;
  memberIntent: boolean;
  profileExists: boolean;
};

export type IdentityResolution =
  /** Existing tenant, pending staff invite, or an explicit merchant signup. Take the old path. */
  | { kind: "merchant"; reason: string; identity: AccountIdentity | null }
  /** A loyalty member with no tenancy. Provision NOTHING. */
  | { kind: "member"; memberId: string | null; identity: AccountIdentity }
  /** Classifier unreachable and no merchant intent. Provision nothing. */
  | { kind: "unknown"; reason: string; identity: AccountIdentity | null };

/** Cache keyed by auth user id; cleared on sign-out via `resetMemberIdentityCache`. */
const cache = new Map<string, IdentityResolution>();

export function resetMemberIdentityCache(): void {
  cache.clear();
}

/**
 * Merchant intent read straight from the session metadata — no server round trip.
 *
 * These are the exact keys the existing merchant signup has always written
 * (`src/hooks/useAuth.ts`: `business_name`, `organization_name`, `pos_role: "owner"`), which is
 * what makes this a backward-compatibility bridge rather than a new convention: every
 * pre-existing merchant already carries them.
 */
export function merchantIntentFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const m = metadata ?? {};
  const isOwner = m.pos_role === "owner";
  const hasBusiness =
    (typeof m.business_name === "string" && m.business_name.trim() !== "") ||
    (typeof m.organization_name === "string" && m.organization_name.trim() !== "");
  return isOwner && hasBusiness;
}

export function memberIntentFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return (metadata ?? {}).account_kind === "member";
}

/**
 * Precedence, in order:
 *   1. Existing tenancy or a pending staff invite  -> merchant (never disrupt a live tenant)
 *   2. member_intent AND a member row              -> member
 *   3. merchant_intent from signup metadata        -> merchant
 *   4. anything else                               -> unknown (bootstrap nothing)
 *
 * Member intent deliberately outranks merchant intent so that a session carrying both cannot be
 * pushed into a tenancy. The reverse — a member who later wants a shop — is a product decision
 * that needs its own flow, not an accidental fallthrough.
 */
export function resolveFromIdentity(
  identity: AccountIdentity,
  localMerchantIntent: boolean,
): IdentityResolution {
  if (identity.isShopMember || identity.isOrgMember || identity.hasPendingStaffInvite) {
    return {
      kind: "merchant",
      reason: identity.hasPendingStaffInvite ? "pending_staff_invite" : "existing_tenancy",
      identity,
    };
  }
  if (identity.memberIntent && identity.isMember) {
    return { kind: "member", memberId: identity.memberId, identity };
  }
  if (identity.isMember && !localMerchantIntent) {
    // A member row without explicit member intent is still a member: refusing to bootstrap is the
    // safe direction, and the account can be sorted out by an explicit flow later.
    return { kind: "member", memberId: identity.memberId, identity };
  }
  if (identity.merchantIntent || localMerchantIntent) {
    return { kind: "merchant", reason: "merchant_intent", identity };
  }
  return { kind: "unknown", reason: "unclassified", identity };
}

export async function resolveAccountIdentity(opts: {
  userId: string | null | undefined;
  metadata?: Record<string, unknown> | null;
  /** Bypass the cache — used by tests and by explicit re-checks. */
  force?: boolean;
}): Promise<IdentityResolution> {
  const uid = String(opts.userId ?? "").trim();
  const localMerchantIntent = merchantIntentFromMetadata(opts.metadata);

  if (!uid) {
    return { kind: "unknown", reason: "no_user", identity: null };
  }
  if (!opts.force) {
    const cached = cache.get(uid);
    if (cached) return cached;
  }

  if (!hasSupabaseConfig || !supabase) {
    // Local / offline mode has no classifier. Never invent a member, never provision a tenant.
    const local: IdentityResolution = localMerchantIntent
      ? { kind: "merchant", reason: "offline_merchant_intent", identity: null }
      : { kind: "unknown", reason: "offline", identity: null };
    cache.set(uid, local);
    return local;
  }

  let resolution: IdentityResolution;
  try {
    const { data, error } = await supabase.rpc("waka_account_identity");
    const raw = (data ?? {}) as Record<string, unknown>;
    if (error || raw.ok !== true) throw new Error(String(error?.message ?? raw.error ?? "identity_failed"));

    const identity: AccountIdentity = {
      authUserId: String(raw.auth_user_id ?? uid),
      isMember: raw.is_member === true,
      memberId: raw.member_id == null ? null : String(raw.member_id),
      memberStatus: raw.member_status == null ? null : String(raw.member_status),
      isShopMember: raw.is_shop_member === true,
      shopId: raw.shop_id == null ? null : String(raw.shop_id),
      membershipRole: raw.membership_role == null ? null : String(raw.membership_role),
      isOrgMember: raw.is_org_member === true,
      organizationId: raw.organization_id == null ? null : String(raw.organization_id),
      hasPendingStaffInvite: raw.has_pending_staff_invite === true,
      merchantIntent: raw.merchant_intent === true,
      memberIntent: raw.member_intent === true,
      profileExists: raw.profile_exists === true,
    };
    resolution = resolveFromIdentity(identity, localMerchantIntent);
  } catch {
    // FAIL CLOSED. An unreachable classifier must never grant a tenancy.
    resolution = localMerchantIntent
      ? { kind: "merchant", reason: "classifier_unavailable_merchant_intent", identity: null }
      : { kind: "unknown", reason: "classifier_unavailable", identity: null };
  }

  cache.set(uid, resolution);
  return resolution;
}

/** True when this session must not be bootstrapped into a tenancy. */
export function blocksOwnerBootstrap(resolution: IdentityResolution): boolean {
  return resolution.kind !== "merchant";
}
