/**
 * Staff sign-in helpers — the ONLINE (Google) staff path.
 *
 * NOTHING HERE AUTHENTICATES. Sign-in itself is the existing implementation
 * (`useAuth.signInWithGoogle`), which already selects the GIS popup on web and the system-browser
 * OAuth return on native. This module answers the two questions that follow a successful staff
 * sign-in:
 *
 *   WHICH SHOPS may this account open?   → the server, via `list_user_shops()`
 *   WHICH ONE are they working in?       → the person, or the only one there is
 *
 * The client never invents a shop. `list_user_shops()` is SECURITY DEFINER over `auth.uid()`, so it
 * can only ever return the caller's own memberships, and the choice is committed through
 * `set_user_primary_shop()`, which re-verifies a `shop_members` row server-side before writing.
 * RLS then decides what the session can actually read — a submitted shop id the person does not
 * belong to is refused there, not here.
 *
 * The PIN / offline path (`staffOfflineAuth`) is deliberately untouched and unreferenced: it
 * resolves a shop from the LOCAL cache by name, which is correct for a shared terminal and wrong
 * for a Google sign-in.
 */

import { switchActiveShop } from "./activeShopSwitch";
import { listUserShops, type UserShopRow } from "./primaryShop";
import { hydrateStaffAuthWorkspace } from "./staffAuthHydrate";
import { supabase } from "./supabase";

export type StaffShopOption = {
  shopId: string;
  shopName: string;
  role: string;
  isPrimary: boolean;
};

/**
 * What the sign-in resolved to.
 *  - `none`     no shop this account can open → an error, and nothing is provisioned
 *  - `single`   exactly one → continue without asking
 *  - `multiple` a real choice → ask
 */
export type StaffShopChoice =
  | { kind: "none" }
  | { kind: "single"; shop: StaffShopOption }
  | { kind: "multiple"; shops: StaffShopOption[] };

/**
 * Server rows → picker options. Malformed rows are dropped rather than rendered: a row without a
 * usable id cannot be opened, and offering it would be a dead end.
 *
 * Ordered primary-first, then by name, so the list is stable between renders and the shop the
 * account normally works in is the obvious default.
 */
export function toStaffShopOptions(rows: readonly UserShopRow[] | null | undefined): StaffShopOption[] {
  const options: StaffShopOption[] = [];
  for (const row of rows ?? []) {
    const shopId = String(row?.shop_id ?? "").trim();
    if (!shopId) continue;
    const shopName = String(row?.shop_name ?? "").trim();
    options.push({
      shopId,
      shopName: shopName || "DKASU POS shop",
      role: String(row?.role ?? "").trim(),
      isPrimary: row?.is_primary === true,
    });
  }
  options.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.shopName.localeCompare(b.shopName);
  });
  return options;
}

/** The one decision this module makes. Pure, so it is the same for web and native. */
export function chooseStaffShop(shops: readonly StaffShopOption[]): StaffShopChoice {
  if (shops.length === 0) return { kind: "none" };
  if (shops.length === 1) return { kind: "single", shop: shops[0]! };
  return { kind: "multiple", shops: [...shops] };
}

/**
 * `user_can_access_shop()` — the exact predicate behind the `shop_members` / `shop_pos_staff` RLS
 * policies, callable because it is granted to `authenticated`. It always evaluates `auth.uid()`,
 * so a caller can only ever ask about themselves.
 *
 * FAILS OPEN on purpose. If the check cannot be made, the shop stays listed: RLS is, and remains,
 * what actually refuses the data, so an unanswered check may cost a clearer message but can never
 * grant access. The reverse — hiding a valid shop because a request failed — would lock a real
 * staff member out of their own shop.
 */
async function canAccessShop(shopId: string): Promise<boolean> {
  const client = supabase;
  if (!client) return true;
  try {
    const { data, error } = await client.rpc("user_can_access_shop", { p_shop: shopId });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

/**
 * Shops this authenticated account may actually OPEN.
 *
 * `list_user_shops()` reports MEMBERSHIP, and being SECURITY DEFINER it keeps listing a shop whose
 * staff row the owner has since disabled or deleted. Filtering by `user_can_access_shop()` turns
 * that into an access list, so a disabled staff member is told they have no staff access up front
 * rather than being walked toward a shop whose data RLS will refuse.
 *
 * Never throws — an unreachable server is "no access".
 */
export async function listAccessibleStaffShops(): Promise<StaffShopOption[]> {
  try {
    const options = toStaffShopOptions(await listUserShops());
    if (options.length === 0) return [];
    const allowed = await Promise.all(options.map((shop) => canAccessShop(shop.shopId)));
    return options.filter((_, index) => allowed[index]);
  } catch {
    return [];
  }
}

export type StaffShopSelectResult =
  | { ok: true }
  | { ok: false; error: "invalid_shop" | "not_member" | "unavailable" };

/** Fresh cloud pull for the shop partition that was just attached. Best effort, like the invite flow. */
async function hydrateSelectedShop(): Promise<void> {
  const client = supabase;
  if (!client) return;
  try {
    const { data } = await client.auth.getUser();
    const userId = data.user?.id;
    if (userId) await hydrateStaffAuthWorkspace(userId);
  } catch {
    /* the POS still opens from the local partition; the background sync will catch up */
  }
}

/**
 * Commit the chosen shop and attach its partition.
 *
 * This is `switchActiveShop` — the SAME branch switch the in-app shop selector uses — not a new
 * path: it re-checks membership against `list_user_shops()`, detaches the previous shop partition
 * and attaches the chosen one, and only then persists it through `set_user_primary_shop()`, which
 * verifies the `shop_members` row again server-side. A forged id therefore fails here
 * (`not_member` / `invalid_shop`) and would fail again at the RPC.
 *
 * `same_shop` is success for this caller: the partition is already the one that was asked for.
 */
export async function selectStaffShop(shopId: string): Promise<StaffShopSelectResult> {
  const id = String(shopId ?? "").trim();
  if (!id) return { ok: false, error: "invalid_shop" };

  try {
    const switched = await switchActiveShop(id, { updatePrimary: true });
    if (!switched.ok && switched.error !== "same_shop") {
      return { ok: false, error: switched.error === "invalid_shop" ? "invalid_shop" : "not_member" };
    }
  } catch {
    return { ok: false, error: "unavailable" };
  }

  await hydrateSelectedShop();
  return { ok: true };
}

/**
 * STAFF-INTENT MARKER.
 *
 * Records, for the duration of one sign-in attempt, that a session established from now on was
 * started from the STAFF entry — as opposed to the owner form, which shares the same underlying
 * Google implementation.
 *
 * It is needed on the native shell, where the Google round trip leaves the WebView and returns
 * through the deep link as a FULL PAGE RELOAD: nothing in memory survives, so without a marker the
 * callback page cannot tell a staff sign-in from a merchant one and would send the person down the
 * owner destination. On web the marker is unnecessary but harmless — the popup never unloads the
 * page.
 *
 * It holds a flag, never an identity, a token or a shop: the shop is resolved from the server
 * afterwards. sessionStorage, so it dies with the sign-in attempt.
 */
const STAFF_LOGIN_INTENT_KEY = "waka.staffLogin.intent";

export function markStaffLoginIntent(): void {
  try {
    sessionStorage.setItem(STAFF_LOGIN_INTENT_KEY, "1");
  } catch {
    /* quota / private mode — the web path does not need it */
  }
}

export function hasStaffLoginIntent(): boolean {
  try {
    return sessionStorage.getItem(STAFF_LOGIN_INTENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearStaffLoginIntent(): void {
  try {
    sessionStorage.removeItem(STAFF_LOGIN_INTENT_KEY);
  } catch {
    /* ignore */
  }
}
