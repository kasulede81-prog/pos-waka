import { fetchProfilePrimaryShopId, listUserShops, type UserShopRow } from "./primaryShop";
import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { hasSupabaseConfig } from "./supabase";
import { setCachedShopId, clearCachedShopId } from "./shopSyncContext";
import { getActiveAccountKey } from "../offline/accountScope";
import { migrateLegacyPersistenceToShop } from "../offline/shopScopeMigration";
import {
  clearPersistedLastActiveShopId,
  getActiveShopId,
  isValidShopId,
  persistLastActiveShopId,
  readPersistedLastActiveShopId,
  setActiveShopId,
  setActiveShopState,
  type ActiveShopState,
} from "../offline/shopScope";
import { withTimeout } from "./promiseTimeout";
import { bootTrace } from "./bootTrace";
import { markStartupPerf } from "./startupPerformance";

function isMember(shopId: string, memberIds: ReadonlySet<string>): boolean {
  return memberIds.has(shopId);
}

/** Fail-soft bound for listUserShops + membership resolution. Must stay under the 12s boot escape. */
export const SHOP_NETWORK_TIMEOUT_MS = 4_000;

type NetworkShopResult =
  | { status: "ok"; shopId: string | null; shops: UserShopRow[] }
  | { status: "timeout"; shopId: null; shops: [] }
  | { status: "error"; shopId: null; shops: [] };

/**
 * Membership-guarded primary resolution (never activates a shop missing from
 * the loaded membership list), shared by the boot path. Network call is made
 * by the caller under the boot timeout bound.
 */
async function resolveShopFromNetworkUncapped(userId: string): Promise<{
  shopId: string | null;
  shops: UserShopRow[];
}> {
  const shops = await listUserShops();
  const memberIds = new Set(shops.map((s) => s.shop_id).filter((id) => isValidShopId(id)));
  let shopId: string | null = null;

  const primaryRow = shops.find((s) => s.is_primary);
  if (primaryRow && isValidShopId(primaryRow.shop_id) && isMember(primaryRow.shop_id, memberIds)) {
    shopId = primaryRow.shop_id;
  } else if (shops.length === 1 && isValidShopId(shops[0]!.shop_id)) {
    shopId = shops[0]!.shop_id;
  } else {
    const profilePrimary = await fetchProfilePrimaryShopId(userId);
    if (profilePrimary && isValidShopId(profilePrimary) && isMember(profilePrimary, memberIds)) {
      shopId = profilePrimary;
    } else {
      const org = await resolvePrimaryOrganizationForUser(userId);
      if (org?.shopId && isValidShopId(org.shopId) && isMember(org.shopId, memberIds)) {
        shopId = org.shopId;
      }
    }
  }

  return { shopId, shops };
}

async function resolveShopFromNetwork(userId: string): Promise<NetworkShopResult> {
  try {
    const timed = await withTimeout(resolveShopFromNetworkUncapped(userId), SHOP_NETWORK_TIMEOUT_MS, null);
    if (timed === null) return { status: "timeout", shopId: null, shops: [] };
    return { status: "ok", shopId: timed.shopId, shops: timed.shops };
  } catch {
    return { status: "error", shopId: null, shops: [] };
  }
}

/**
 * Activate `shopId` — but only while the attempt that asked for it is still authoritative.
 *
 * Returns whether anything was published. Every mutation here is shared state, so a superseded
 * attempt that got this far must leave all of it alone: writing the active shop, the sync-side
 * cached shop, the persisted last shop, or migrating legacy rows are all actions taken ON BEHALF
 * OF an account, and the account may no longer be the one in use.
 */
async function activateKnownShop(shopId: string, stillAuthoritative: () => boolean): Promise<boolean> {
  if (!stillAuthoritative()) return false;
  setActiveShopId(shopId);
  setCachedShopId(shopId);
  persistLastActiveShopId(shopId);
  // The migration awaits, so the guard is re-checked: rows must not be moved into a shop that
  // stopped being this account's while the write was in flight.
  if (stillAuthoritative()) await migrateLegacyPersistenceToShop(shopId);
  return true;
}

/**
 * Resolve and activate the initial shop before local bootstrap.
 * Local in-memory shop for THIS account is kept first (offline / still a
 * member); otherwise network membership resolution is time-bounded (4s) and
 * membership-guarded — never guesses among multiple shops without primary,
 * never activates a shop missing from the loaded membership list.
 */
export async function initializeActiveShopForAccount(
  userId: string | null,
  opts?: {
    /**
     * Asked before every publish: is the boot that started this attempt still the current one?
     *
     * The account key alone cannot answer this — two boots for the SAME account (a retry, or a
     * remount) are indistinguishable by key, and the older one must still lose. The boot provider
     * owns the generation, so it supplies the check.
     */
    isCurrent?: () => boolean;
  },
): Promise<string | null> {
  bootTrace("BOOT-013", "initialize_active_shop", "START");
  markStartupPerf("initialize_active_shop_start");

  /**
   * WHOSE ATTEMPT IS THIS? Captured before the first await, so it records the account this
   * resolution is FOR and not the one that happens to be live when it finishes.
   *
   * The boot provider's generation guard runs only after this function has returned — it cannot
   * protect any of the mutations made inside it. So the attempt carries its own authority and
   * refuses to publish once it has lost it, at the mutation rather than after it.
   */
  const accountAtEntry = getActiveAccountKey();
  const stillAuthoritative = (): boolean =>
    getActiveAccountKey() === accountAtEntry && (opts?.isCurrent?.() ?? true);

  /**
   * Classify by the RESULT, never by how we got here. A timeout that restored the persisted last
   * shop ends with a real shop and is genuinely `ready`; a timeout with nothing to restore is not,
   * and must stay unresolved so the boot provider keeps refusing to declare the POS ready. Deriving
   * the state from the returned id is what stops a failed initialization from masquerading as an
   * answer — including the tempting shortcut of calling it `no-shop` just because it came back
   * empty.
   *
   * A SUPERSEDED attempt publishes nothing — not even `no-shop` or `initializing`. Reporting
   * "unresolved" on behalf of an account that is no longer live would stall a POS that a newer
   * boot has already resolved, which is just the same race wearing a different hat. It resolves to
   * `null`: this attempt has no result for whoever is running now.
   */
  const finish = (
    shopId: string | null,
    unresolvedState: ActiveShopState,
    outcome: "SUCCESS" | "FAILED" | "TIMEOUT",
    extra?: Record<string, unknown>,
  ) => {
    if (!stillAuthoritative()) {
      bootTrace("BOOT-013", "initialize_active_shop", "FAILED", { ...extra, via: "superseded" });
      markStartupPerf("initialize_active_shop_end");
      return null;
    }
    setActiveShopState(isValidShopId(shopId) ? "ready" : unresolvedState);
    bootTrace("BOOT-013", "initialize_active_shop", outcome, extra);
    markStartupPerf("initialize_active_shop_end");
    return shopId;
  };

  /** Runs a shared-state mutation only while this attempt still owns the right to publish it. */
  const publish = (mutate: () => void): boolean => {
    if (!stillAuthoritative()) return false;
    mutate();
    return true;
  };

  try {
    if (!hasSupabaseConfig || !userId || !getActiveAccountKey()?.startsWith("sb:")) {
      // No account at all is `signed-out`; an offline-only `local:` account needs no shop
      // dimension, which is `not-required` rather than a shop we failed to find.
      return finish(getActiveShopId(), userId ? "not-required" : "signed-out", "SUCCESS", {
        via: "non_supabase_or_no_user",
      });
    }

    // A shop-capable account, resolving now. Until an exit path below says otherwise the context
    // is unresolved, so nothing may treat a null id as an answer in the meantime.
    publish(() => setActiveShopState("initializing"));

    const net = await resolveShopFromNetwork(userId);
    const current = getActiveShopId();

    if (net.status !== "ok") {
      // Network unavailable (timeout/error): boot from local state only —
      // never fabricate a shop. In-memory shop wins; otherwise restore the
      // persisted last shop for THIS account namespace (T3/T4/T6: hanging or
      // failed listUserShops cannot block startup or cross-restore).
      if (current && isValidShopId(current)) {
        if (stillAuthoritative()) await migrateLegacyPersistenceToShop(current);
        publish(() => {
          setCachedShopId(current);
          persistLastActiveShopId(current);
        });
        return finish(current, "initializing", "SUCCESS", { via: "in_memory_offline" });
      }
      const persisted = readPersistedLastActiveShopId();
      if (persisted && isValidShopId(persisted)) {
        await activateKnownShop(persisted, stillAuthoritative);
        return finish(persisted, "initializing", net.status === "timeout" ? "TIMEOUT" : "FAILED", {
          via: "local_restore",
        });
      }
      // Network trouble AND nothing local to fall back on: we do not know this account's shop, so
      // the context stays unresolved. Reporting `no-shop` here would be a fabrication, and it is
      // exactly the case that used to boot the POS into the shopless partition.
      return finish(getActiveShopId(), "initializing", net.status === "timeout" ? "TIMEOUT" : "FAILED", {
        via: "network_unavailable",
      });
    }

    const shops = net.shops;
    const memberIds = new Set(shops.map((s) => s.shop_id).filter((id) => isValidShopId(id)));

    if (current && isValidShopId(current)) {
      // Offline / empty RPC: keep the in-memory shop. Membership loaded: keep
      // only if still a member; otherwise fall through to guarded resolution
      // so a removed shop is never restored.
      if (shops.length === 0 || isMember(current, memberIds)) {
        if (stillAuthoritative()) await migrateLegacyPersistenceToShop(current);
        publish(() => {
          setCachedShopId(current);
          persistLastActiveShopId(current);
        });
        return finish(current, "initializing", "SUCCESS", { via: "in_memory_member" });
      }
    }

    let shopId = net.shopId;

    // Local last-shop restore for THIS account: only when it is a confirmed
    // member — never cross-restores another user's/shop's namespace.
    if (!shopId) {
      const persisted = readPersistedLastActiveShopId();
      if (persisted && isValidShopId(persisted) && isMember(persisted, memberIds)) {
        shopId = persisted;
      }
    }

    if (!shopId) {
      if (current && shops.length > 0 && !isMember(current, memberIds)) {
        // Destructive, so doubly important that a superseded attempt cannot do it: clearing the
        // persisted last shop is an act on behalf of the CURRENT account.
        publish(() => {
          setActiveShopId(null);
          clearCachedShopId();
          clearPersistedLastActiveShopId();
        });
      }
      // The membership list loaded and genuinely contains no shop for this account: a real answer,
      // and a legitimate state to continue from (onboarding), not a failed resolution.
      return finish(getActiveShopId(), "no-shop", "SUCCESS", { via: "no_shop" });
    }

    await activateKnownShop(shopId, stillAuthoritative);
    return finish(shopId, "initializing", "SUCCESS", { via: "network" });
  } catch (err) {
    // A throw leaves the context unresolved for the same reason a network failure does: we never
    // learned the answer. It must not be reported as ready, and it is retryable.
    return finish(getActiveShopId(), "initializing", "FAILED", {
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

/**
 * How long to wait before each re-attempt of an unresolved shop resolution, in order.
 *
 * Deliberately bounded rather than "retry forever": four retries over ~30 seconds turns a flaky
 * first round trip into a normal boot, and a genuinely unreachable backend into a visible startup
 * state with the existing retry/sign-out escape actions — instead of an unbounded loop that hides
 * a real outage. The whole schedule is cancelled the moment the boot is superseded.
 */
export const SHOP_INIT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000] as const;

export type ShopContextBootDeps = {
  /** `initializeActiveShopForAccount`. Injected so the retry policy is testable in isolation. */
  initialize: (userId: string | null) => Promise<string | null>;
  getState: () => ActiveShopState;
  getAccountKey: () => string | null;
  /**
   * False once the boot this belongs to has been superseded (account change, unmount, or a newer
   * boot generation). Checked after every await, so a superseded boot can neither retry nor
   * activate anything.
   */
  isCurrent: () => boolean;
  /** Cancellable inter-attempt wait, so unmount cannot leave a retry armed. */
  wait: (ms: number) => Promise<void>;
};

export type ShopContextBootOutcome = {
  /** The lifecycle state after the last attempt — `initializing` means still unresolved. */
  state: ActiveShopState;
  /** How many times `initialize` was called. */
  attempts: number;
};

/**
 * Resolve the account's shop context, retrying a FAILED/UNRESOLVED attempt a bounded number of
 * times.
 *
 * WHY RETRY AT ALL. Resolution is a network round trip bounded at 4s, and a single failure used to
 * be final: `runBoot` had no second caller of `initializeActiveShopForAccount`, so one bad round
 * trip left the whole session without a shop and only a manual page refresh could fix it — the
 * "sometimes it misbehaves, then refreshing fixes it" symptom.
 *
 * WHAT IS *NOT* RETRIED. Only `initializing` is. `ready`, `no-shop`, `signed-out` and
 * `not-required` are all CONCLUSIONS, and re-running resolution after any of them would either
 * re-ask a question that was already answered or try to resurrect a signed-out session.
 *
 * NOTHING IS FABRICATED. A retry only ever re-runs the same guarded resolution; it cannot invent a
 * shop, and if every attempt fails the context simply stays unresolved for the caller to handle.
 */
export async function resolveShopContextForBoot(
  deps: ShopContextBootDeps,
  input: { userId: string | null; accountKey: string | null },
): Promise<ShopContextBootOutcome> {
  let attempts = 0;

  // One initial attempt plus one per delay: the last iteration always finds `undefined` and stops.
  for (let index = 0; index <= SHOP_INIT_RETRY_DELAYS_MS.length; index += 1) {
    attempts += 1;
    await deps.initialize(input.userId);

    if (!deps.isCurrent()) return { state: deps.getState(), attempts };

    const state = deps.getState();
    if (state !== "initializing") return { state, attempts };

    const delay = SHOP_INIT_RETRY_DELAYS_MS[index];
    if (delay === undefined) return { state, attempts };

    await deps.wait(delay);

    if (!deps.isCurrent()) return { state: deps.getState(), attempts };
    // The account this boot belongs to must still be the active one. Without this a retry armed
    // for account A could resolve — and activate — a shop while account B is live.
    if (deps.getAccountKey() !== input.accountKey) {
      return { state: deps.getState(), attempts };
    }
  }

  return { state: deps.getState(), attempts };
}
