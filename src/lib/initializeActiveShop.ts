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

async function activateKnownShop(shopId: string): Promise<string> {
  setActiveShopId(shopId);
  setCachedShopId(shopId);
  persistLastActiveShopId(shopId);
  await migrateLegacyPersistenceToShop(shopId);
  return shopId;
}

/**
 * Resolve and activate the initial shop before local bootstrap.
 * Local in-memory shop for THIS account is kept first (offline / still a
 * member); otherwise network membership resolution is time-bounded (4s) and
 * membership-guarded — never guesses among multiple shops without primary,
 * never activates a shop missing from the loaded membership list.
 */
export async function initializeActiveShopForAccount(userId: string | null): Promise<string | null> {
  bootTrace("BOOT-013", "initialize_active_shop", "START");
  markStartupPerf("initialize_active_shop_start");

  const finish = (
    shopId: string | null,
    outcome: "SUCCESS" | "FAILED" | "TIMEOUT",
    extra?: Record<string, unknown>,
  ) => {
    bootTrace("BOOT-013", "initialize_active_shop", outcome, extra);
    markStartupPerf("initialize_active_shop_end");
    return shopId;
  };

  try {
    if (!hasSupabaseConfig || !userId || !getActiveAccountKey()?.startsWith("sb:")) {
      return finish(getActiveShopId(), "SUCCESS", { via: "non_supabase_or_no_user" });
    }

    const net = await resolveShopFromNetwork(userId);
    const current = getActiveShopId();

    if (net.status !== "ok") {
      // Network unavailable (timeout/error): boot from local state only —
      // never fabricate a shop. In-memory shop wins; otherwise restore the
      // persisted last shop for THIS account namespace (T3/T4/T6: hanging or
      // failed listUserShops cannot block startup or cross-restore).
      if (current && isValidShopId(current)) {
        await migrateLegacyPersistenceToShop(current);
        setCachedShopId(current);
        persistLastActiveShopId(current);
        return finish(current, "SUCCESS", { via: "in_memory_offline" });
      }
      const persisted = readPersistedLastActiveShopId();
      if (persisted && isValidShopId(persisted)) {
        await activateKnownShop(persisted);
        return finish(persisted, net.status === "timeout" ? "TIMEOUT" : "FAILED", {
          via: "local_restore",
        });
      }
      return finish(getActiveShopId(), net.status === "timeout" ? "TIMEOUT" : "FAILED", {
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
        await migrateLegacyPersistenceToShop(current);
        setCachedShopId(current);
        persistLastActiveShopId(current);
        return finish(current, "SUCCESS", { via: "in_memory_member" });
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
        setActiveShopId(null);
        clearCachedShopId();
        clearPersistedLastActiveShopId();
      }
      return finish(getActiveShopId(), "SUCCESS", { via: "no_shop" });
    }

    await activateKnownShop(shopId);
    return finish(shopId, "SUCCESS", { via: "network" });
  } catch (err) {
    return finish(getActiveShopId(), "FAILED", {
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}
