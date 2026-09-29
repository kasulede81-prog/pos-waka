/**
 * Explicit merchant intent (Phase 2C).
 *
 * The email signup has always declared merchant intent as a side effect of creating the account:
 * `useAuth.signUp` writes `pos_role`, `business_name` and `organization_name` into the new user's
 * metadata, and the Phase 1 gate (`merchantIntentFromMetadata`) reads exactly those keys. A Google
 * identity carries NONE of that, which is deliberate — we must never infer merchant intent from
 * the fact that someone authenticated with Google.
 *
 * So a Google user who wants a shop says so, here. This module writes the SAME metadata shape the
 * email signup writes, so the Phase 1 classifier recognises it without any new convention and
 * without any change to the gate.
 *
 * WHAT THIS DOES NOT DO — and must never do:
 *   it creates no organization, no shop, no subscription, no `profiles` row, no `shop_members`
 *   row, and it does not call `bootstrapOwnerWorkspace` or `bootstrap_owner_workspace`.
 *
 * MERCHANT INTENT IS NOT MERCHANT AUTHORIZATION. Declaring it changes which onboarding surface a
 * session is sent to; it does not by itself provision anything. Provisioning still happens in the
 * one guarded place it always has — `ensureWorkspaceForSession`, behind `resolveAccountIdentity`
 * and `blocksOwnerBootstrap`, driven by the `bootstrap_owner_workspace` RPC.
 */

import { supabase } from "./supabase";
import { resetMemberIdentityCache } from "./memberIdentity";
import { usePosStore } from "../store/usePosStore";

const SHOP_NAME_MAX = 80;
const OWNER_NAME_MAX = 120;

export type MerchantIntentResult = { ok: true } | { ok: false; error: string };

function clean(value: string | undefined, max: number): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  return v.slice(0, max);
}

/**
 * Record the intent to run a shop, on the CURRENTLY AUTHENTICATED account.
 *
 * The shop name is required because `merchantIntentFromMetadata` requires a business name — that
 * is what separates "I clicked a button" from "I am starting a named business". The owner name is
 * optional and only fills the profile's display name.
 */
export async function declareMerchantIntent(input: {
  shopName: string;
  ownerName?: string;
}): Promise<MerchantIntentResult> {
  if (!supabase) return { ok: false, error: "offline" };

  const shopName = clean(input.shopName, SHOP_NAME_MAX);
  if (!shopName) return { ok: false, error: "invalid_shop_name" };
  const ownerName = clean(input.ownerName, OWNER_NAME_MAX);

  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) return { ok: false, error: "not_authenticated" };

    // Merge rather than replace: a merchant who is also a WAKA Loyalty member must keep
    // `account_kind`, and a returning merchant must keep every other key they already carry.
    const current = (user.user_metadata ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = {
      ...current,
      pos_role: "owner",
      business_name: shopName,
      organization_name: shopName,
      shop_display_name: shopName,
    };
    if (ownerName) next.full_name = ownerName;

    const { error } = await supabase.auth.updateUser({ data: next });
    if (error) return { ok: false, error: "update_failed" };

    // The classifier caches per user id; the new intent must be visible on the next resolve or
    // /onboarding stays unreachable.
    resetMemberIdentityCache();

    // Local only — so the onboarding wizard shows the name the person just typed instead of its
    // "My Shop" fallback. Nothing here is a write to the server.
    try {
      usePosStore.getState().setPreferences({ shopDisplayName: shopName });
    } catch {
      /* the wizard falls back to its placeholder; not worth failing the intent for */
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
