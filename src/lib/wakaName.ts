/**
 * Confirming a WAKA name — the one write that turns a person's choice into their WAKA identity.
 *
 * WHY THIS IS NOT IN `merchantIntent`. That module carries a documented and tested invariant: it
 * writes metadata and creates nothing — no profile, no organization, no shop, no RPC. Confirmation
 * has to do more than that (it must also set the canonical `profiles.full_name`), so folding it in
 * would quietly break the guarantee that module is trusted for. Declaring intent and confirming a
 * name are two decisions, and they stay two functions.
 *
 * THE ORDER IS THE POINT. Metadata is written FIRST because it is the durable record: `waka_full_name`
 * is a key no provider will ever touch, so once it lands, the confirmed name survives every later
 * Google sign-in regardless of whether the auth server refreshes provider claims (that behaviour was
 * never empirically established, and this design does not depend on it). The `profiles` row is then
 * updated to match — and if it does not exist yet, that is not a failure: the guarded bootstrap
 * carries `waka_full_name` into the new row when it runs.
 */

import { supabase } from "./supabase";
import {
  FULL_NAME_MAX,
  WAKA_FULL_NAME_KEY,
  WAKA_NAME_CONFIRMED_AT_KEY,
  normalizeNamePart,
  readConfirmedWakaName,
} from "./nameReview";

export type ConfirmWakaNameResult =
  | { ok: true; fullName: string; profileUpdated: boolean }
  | { ok: false; error: "not_authenticated" | "invalid_name" | "offline" | "unavailable" };

/**
 * Persist `fullName` as this person's confirmed WAKA name.
 *
 * Idempotent: confirming the same name twice writes the same values. Re-confirming a different name
 * is allowed — it is the person's own decision — and the marker is refreshed with it.
 */
export async function confirmWakaName(input: { fullName: string }): Promise<ConfirmWakaNameResult> {
  if (!supabase) return { ok: false, error: "offline" };

  const fullName = normalizeNamePart(input.fullName).slice(0, FULL_NAME_MAX);
  if (!fullName) return { ok: false, error: "invalid_name" };

  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) return { ok: false, error: "not_authenticated" };

    // Merge, never replace: this account may already carry `pos_role`, `account_kind`,
    // `business_name` and anything else. A replacement would strip a member's identity or a
    // merchant's declared intent.
    const current = (user.user_metadata ?? {}) as Record<string, unknown>;
    const { error } = await supabase.auth.updateUser({
      data: {
        ...current,
        // Kept in step for every existing reader, but NOT the authority — see readConfirmedWakaName.
        full_name: fullName,
        [WAKA_FULL_NAME_KEY]: fullName,
        [WAKA_NAME_CONFIRMED_AT_KEY]: new Date().toISOString(),
      },
    });
    if (error) return { ok: false, error: "unavailable" };

    /**
     * Canonical value, CREATED IF ABSENT — not merely updated.
     *
     * WHY THIS IS AN UPSERT AND NOT AN UPDATE. A brand-new Google merchant confirms their name
     * before any workspace exists, so there is no `profiles` row yet and a plain UPDATE silently
     * affects zero rows. They then complete the wizard without ever reloading; the wizard's
     * `save_owner_business_profile_bundle` call is what finally creates the profile row — and its
     * INSERT branch seeds `full_name` from `p_shop_name`, so the SHOP's name became the person's
     * and, because the bundle also creates everything `owner_workspace_health()` checks,
     * `repair_owner_workspace` then short-circuits forever and nothing ever corrected it.
     *
     * Writing the row here closes that window: by the time the bundle runs, the profile already
     * exists and carries the confirmed name, so its ON CONFLICT branch (`coalesce(nullif(existing,
     * ''), excluded.full_name)`) keeps it and the shop name is never consulted.
     *
     * ONLY (id, full_name) IS SENT. PostgREST turns this into `insert … on conflict (id) do update
     * set full_name = excluded.full_name`, so no other column is written or blanked on the update
     * path, and on the insert path the table's own defaults (`role`, `default_currency`, `locale`,
     * timestamps) apply. RLS permits both halves: `profiles_self_insert` checks `auth.uid() = id`
     * and `profiles_self_update` matches on `auth.uid() = id`.
     */
    let profileUpdated = false;
    try {
      const { error: profileErr } = await supabase
        .from("profiles")
        .upsert({ id: user.id, full_name: fullName }, { onConflict: "id" });
      if (profileErr) {
        // Not fatal, and not silent. The confirmed name is already durable in `waka_full_name`, and
        // the guarded bootstrap carries that into the profile whenever it next runs — so the person
        // is not blocked here on a write that has a backstop. It IS logged, because this is also
        // the write that keeps the bundle RPC's shop-name fallback out of reach.
        console.error("[waka-name] profiles.full_name write failed", profileErr.message);
      } else {
        profileUpdated = true;
      }
    } catch (e) {
      console.error("[waka-name] profiles.full_name write threw", e);
    }

    return { ok: true, fullName, profileUpdated };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** Has this account already confirmed a WAKA name? Reads the durable marker pair. */
export function hasConfirmedWakaName(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return readConfirmedWakaName(metadata) !== null;
}
