import { flushPendingPersist, usePosStore, bootstrapPosFromDisk } from "../store/usePosStore";
import { listUserShops, setUserPrimaryShop } from "./primaryShop";
import { setCachedShopId, clearShopCtxTick, clearCachedShopId } from "./shopSyncContext";
import { getActiveShopId, isValidShopId, persistLastActiveShopId, setActiveShopId } from "../offline/shopScope";
import { migrateLegacyPersistenceToShop } from "../offline/shopScopeMigration";

export type ActiveShopSwitchResult = {
  ok: boolean;
  error?: "not_member" | "invalid_shop" | "same_shop";
};

/**
 * Explicit branch switch — no business mutation; detaches A partition, attaches B.
 */
export async function switchActiveShop(
  nextShopId: string,
  opts?: { updatePrimary?: boolean },
): Promise<ActiveShopSwitchResult> {
  if (!isValidShopId(nextShopId)) {
    return { ok: false, error: "invalid_shop" };
  }

  const current = getActiveShopId();
  if (current === nextShopId) {
    return { ok: false, error: "same_shop" };
  }

  const shops = await listUserShops();
  if (!shops.some((s) => s.shop_id === nextShopId)) {
    return { ok: false, error: "not_member" };
  }

  flushPendingPersist();
  usePosStore.getState().resetForSignOut();
  clearShopCtxTick();

  setActiveShopId(nextShopId);
  setCachedShopId(nextShopId);
  persistLastActiveShopId(nextShopId);
  await migrateLegacyPersistenceToShop(nextShopId);

  if (opts?.updatePrimary) {
    await setUserPrimaryShop(nextShopId);
  }

  await bootstrapPosFromDisk();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("waka:active-shop-changed", { detail: { shopId: nextShopId } }));
  }

  return { ok: true };
}

export function clearActiveShopOnSignOut(): void {
  setActiveShopId(null);
  clearCachedShopId();
  clearShopCtxTick();
}
