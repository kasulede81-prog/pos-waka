import { getDeviceOnline } from "./deviceOnline";
import { hasSupabaseConfig } from "./supabase";
import { usePosStore } from "../store/usePosStore";
import { isLocalShopDataEmpty, restoreShopFromCloudSnapshot, uploadShopCloudSnapshot } from "./cloudSnapshotSync";

async function waitForPosStoreHydrated(timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (usePosStore.getState()._hydrated) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return usePosStore.getState()._hydrated;
}

/**
 * After sign-in on a new device: wait for local bootstrap, restore full cloud snapshot when empty,
 * then merge live rows (products/sales/customers) from Supabase tables.
 */
export async function hydrateAccountFromCloud(opts?: {
  forcePull?: boolean;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  if (!hasSupabaseConfig) return;

  await waitForPosStoreHydrated();

  const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
  await hydrateLocalShopProfileFromCloud().catch(() => undefined);

  const localEmpty = isLocalShopDataEmpty();

  const { pullCloudAndMergeIntoStore, syncShopWithCloud, pushShopPendingToCloud } = await import(
    "../offline/cloudSync",
  );

  if (localEmpty) {
    const restored = await restoreShopFromCloudSnapshot(opts?.onProgress).catch(() => false);
    if (restored) {
      const { applyShopRecoverySignalsForCurrentShop } = await import("./shopRecoverySignals");
      await applyShopRecoverySignalsForCurrentShop().catch(() => undefined);
      if (getDeviceOnline()) {
        await pushShopPendingToCloud().catch(() => undefined);
        await uploadShopCloudSnapshot().catch(() => false);
      }
      return;
    }
    if (opts?.forcePull || localEmpty) {
      await pullCloudAndMergeIntoStore().catch(() => undefined);
    }
  } else if (getDeviceOnline()) {
    // Shop already on device — push pending rows only; avoid heavy full cloud merge on every open.
    await syncShopWithCloud({ pull: false }).catch(() => undefined);
  }

  if (getDeviceOnline()) {
    await pushShopPendingToCloud().catch(() => undefined);
    await uploadShopCloudSnapshot().catch(() => false);
  }
}
