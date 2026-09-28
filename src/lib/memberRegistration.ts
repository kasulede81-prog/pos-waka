/**
 * Explicit loyalty member registration (Phase 2B).
 *
 * The identity itself is created by `loyalty_member_register()`, which takes NO user id — it
 * resolves the caller from `auth.uid()` and is idempotent on that user. This module is the thin
 * client orchestration around it, and it exists so the two things that must never be separated
 * from a registration happen in one place:
 *
 *   1. the phone is canonicalised through `normalizeUgPhoneE164` — the same authoritative helper
 *      the merchant signup, phone login, shop profile and public enrollment already use, and
 *      logic-identical to `normalizeUgPhone` in the `loyalty-public-enroll` edge function. The
 *      database CHECK (`^\+256[0-9]{9}$`) means a non-canonical value is refused outright, so
 *      normalising here is what makes the Phase 2A phone match possible at all;
 *
 *   2. the identity cache is invalidated. `resolveAccountIdentity` caches per auth user id, so
 *      without this a freshly registered member keeps being routed by their PREVIOUS
 *      classification (`unknown` → /welcome) until a full page reload.
 *
 * REGISTRATION IS AN EXPLICIT ACTION. Nothing here is called automatically from a sign-in, a
 * callback, or the presence of a phone number. A merchant or customer who happens to have a phone
 * on file does not become a member by existing; they become one by asking to.
 */

import { normalizeUgPhoneE164 } from "./businessProfile";
import { registerLoyaltyMember, type MemberResult } from "./memberDashboard";
import { resetMemberIdentityCache } from "./memberIdentity";
import { hasSupabaseConfig, supabase } from "./supabase";

export type BecomeMemberResult =
  | { ok: true; memberId: string; status: string; created: boolean }
  | { ok: false; error: string };

const NAME_MAX = 120;

/**
 * Register (or refresh) the caller's loyalty member identity.
 *
 * Order matters: the member row is created FIRST and the metadata hint is written after. If the
 * hint were written first and the registration then failed, a user with no tenancy would be left
 * carrying member intent with no member row — which classifies as `unknown`, bouncing them out of
 * the merchant branch they may legitimately still want. This order can only ever leave the account
 * more classified, never less.
 */
export async function becomeLoyaltyMember(input: {
  displayName: string;
  phone: string;
}): Promise<BecomeMemberResult> {
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > NAME_MAX) {
    return { ok: false, error: "invalid_name" };
  }

  // The phone is required, not optional: Phase 2A links a shop's account to this identity by
  // matching this exact canonical value, so a member registered without one could never be
  // linked to anything.
  const phoneE164 = normalizeUgPhoneE164(input.phone);
  if (!phoneE164) {
    return { ok: false, error: "invalid_phone" };
  }

  const registered = await registerLoyaltyMember(displayName, phoneE164);
  if (!registered.ok) {
    return { ok: false, error: registered.error };
  }

  // Record member intent so the classifier's member branch is reachable. `account_kind` is read
  // by `waka_account_identity()` but was written by no client path before this — the flag existed
  // and nothing could ever set it.
  //
  // The existing metadata is merged in explicitly rather than relying on the server-side merge, so
  // a merchant joining loyalty cannot lose `pos_role`/`business_name` and be re-classified by
  // accident. Best-effort: the member row above is the authority, and a merchant keeps the
  // merchant path regardless because an existing tenancy is checked before member intent.
  await writeMemberIntent();

  // Without this the cached classification wins and the new member is still routed as `unknown`.
  resetMemberIdentityCache();

  return {
    ok: true,
    memberId: registered.data.memberId,
    status: registered.data.status,
    created: registered.data.created,
  };
}

async function writeMemberIntent(): Promise<void> {
  if (!hasSupabaseConfig || !supabase) return;
  try {
    const { data } = await supabase.auth.getUser();
    const current = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    if (current.account_kind === "member") return;
    await supabase.auth.updateUser({ data: { ...current, account_kind: "member" } });
  } catch {
    /* A metadata hint is not worth failing a registration that already succeeded. */
  }
}

/** Message shown to a member when registration is refused, keyed by the RPC's error codes. */
export function memberRegistrationErrorText(error: string): string {
  switch (error) {
    case "invalid_phone":
      return "Enter a valid Ugandan phone number, for example 0772 123 456.";
    case "invalid_name":
      return "Enter your name (1–120 characters).";
    case "not_authenticated":
      return "Your session expired. Sign in again and retry.";
    case "offline":
    case "unavailable":
      return "We could not reach WAKA. Check your connection and try again.";
    default:
      return "We could not create your Loyalty account. Please try again.";
  }
}

export type { MemberResult };
