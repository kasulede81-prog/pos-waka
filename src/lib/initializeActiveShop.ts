import { fetchProfilePrimaryShopId, listUserShops, type UserShopRow } from "./primaryShop";
import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { hasSupabaseConfig } from "./supabase";
import { setCachedShopId } from "./shopSyncContext";
import { getActiveAccountKey } from "../offline/accountScope";
import { migrateLegacyPersistenceToShop } from "../offline/shopScopeMigration";
import {
  clearPersistedLastActiveShopId,
  getActiveShopId,
  isValidShopId,
  persistLastActiveShopId,
  readPersistedLastActiveShopId,
  setActiveShopId,
} from "../offline/shopScope";
import { withTimeout } from "./promiseTimeout";
import { bootTrace } from "./bootTrace";
import { markStartupPerf } from "./startupPerformance";

/** Fail-soft bound for listUserShops + membership resolution. Must stay under the 12s boot escape. */
export const SHOP_NETWORK_TIMEOUT_MS = 4_000;

type NetworkShopResult =
  | { status: "ok"; shopId: string | null; shops: UserShopRow[] }
  | { status: "timeout"; shopId: null; shops: [] }
  | { status: "error"; shopId: null; shops: [] };

async function resolveShopFromNetworkUncapped(userId: string): Promise<{
  shopId: string | null;
  shops: UserShopRow[];
}> {
  const shops = await listUserShops();
  let shopId: string | null = null;

  const primaryRow = shops.find((s) => s.is_primary);
  if (primaryRow && isValidShopId(primaryRow.shop_id)) {
    shopId = primaryRow.shop_id;
  } else if (shops.length === 1 && isValidShopId(shops[0]!.shop_id)) {
    shopId = shops[0]!.shop_id;
  } else {
    const profilePrimary = await fetchProfilePrimaryShopId(userId);
    if (profilePrimary && isValidShopId(profilePrimary) && shops.some((s) => s.shop_id === profilePrimary)) {
      shopId = profilePrimary;
    } else {
      const org = await resolvePrimaryOrganizationForUser(userId);
      if (org?.shopId && isValidShopId(org.shopId)) {
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

async function activateKnownShop(shopId: string): Promise<string> {
  setActiveShopId(shopId);
  setCachedShopId(shopId);
  persistLastActiveShopId(shopId);
  await migrateLegacyPersistenceToShop(shopId);
  return shopId;
}

/**
 * Previously-validated shop may stay usable offline. Network confirmation that the
 * restored shop is not in membership clears persist so it cannot stay permanently active.
 * Does not silently switch to another shop.
 */
function validateRestoredShopInBackground(userId: string, restoredShopId: string): void {
  void (async () => {
    const net = await resolveShopFromNetwork(userId);
    if (net.status !== "ok") return;
    if (net.shops.some((s) => s.shop_id === restoredShopId)) {
      persistLastActiveShopId(restoredShopId);
      return;
    }
    clearPersistedLastActiveShopId();
  })();
}

/**
 * Resolve and activate the initial shop before local bootstrap.
 * Local last-shop for THIS account is restored first; network membership is time-bounded.
 * Uses membership + primary shop — never guesses among multiple shops without primary.
 */
export async function initializeActiveShopForAccount(userId: string | null): Promise<string | null> {
  bootTrace("BOOT-013", "initialize_active_shop", "START");
  markStartupPerf("initialize_active_shop_start");

  const finish = (shopId: string | null, outcome: "SUCCESS" | "FAILED" | "TIMEOUT", extra?: Record<string, unknown>) => {
    bootTrace("BOOT-013", "initialize_active_shop", outcome, extra);
    markStartupPerf("initialize_active_shop_end");
    return shopId;
  };

  try {
    if (!hasSupabaseConfig || !userId || !getActiveAccountKey()?.startsWith("sb:")) {
      return finish(getActiveShopId(), "SUCCESS", { via: "non_supabase_or_no_user" });
    }

    const inMemory = getActiveShopId();
    if (inMemory && isValidShopId(inMemory)) {
      await migrateLegacyPersistenceToShop(inMemory);
      setCachedShopId(inMemory);
      persistLastActiveShopId(inMemory);
      validateRestoredShopInBackground(userId, inMemory);
      return finish(inMemory, "SUCCESS", { via: "in_memory" });
    }

    const persisted = readPersistedLastActiveShopId();
    if (persisted && isValidShopId(persisted)) {
      await activateKnownShop(persisted);
      validateRestoredShopInBackground(userId, persisted);
      return finish(persisted, "SUCCESS", { via: "local_restore" });
    }

    const net = await resolveShopFromNetwork(userId);
    if (net.status === "timeout") {
      return finish(getActiveShopId(), "TIMEOUT", { timeoutMs: SHOP_NETWORK_TIMEOUT_MS, via: "network" });
    }
    if (net.status === "error") {
      return finish(getActiveShopId(), "FAILED", { via: "network_error" });
    }
    if (!net.shopId) {
      return finish(null, "SUCCESS", { via: "no_shop" });
    }

    await activateKnownShop(net.shopId);
    return finish(net.shopId, "SUCCESS", { via: "network" });
  } catch (err) {
    return finish(getActiveShopId(), "FAILED", {
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}
