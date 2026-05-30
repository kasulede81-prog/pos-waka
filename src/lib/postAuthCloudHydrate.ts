import { getDeviceOnline } from "./deviceOnline";
import { shouldPausePosBackgroundWork } from "./backgroundWorkPolicy";
import { isNativeApp } from "./nativeApp";
import { runWhenIdle } from "./uiYield";
import { hasSupabaseConfig } from "./supabase";
import { usePosStore } from "../store/usePosStore";
import { isLocalShopDataEmpty, restoreShopFromCloudSnapshot, uploadShopCloudSnapshot } from "./cloudSnapshotSync";

const HYDRATE_COOLDOWN_MS = 120_000;
const HYDRATE_FORCE_COOLDOWN_MS = 30_000;

let hydrateInFlight: Promise<void> | null = null;
let lastHydrateFinishedAt = 0;

async function waitForPosStoreHydrated(timeoutMs = 30_000): Promise<boolean> {
  if (usePosStore.getState()._hydrated) return true;
  return new Promise((resolve) => {
    let unsub: (() => void) | null = null;
    const timeoutId = window.setTimeout(() => {
      unsub?.();
      resolve(usePosStore.getState()._hydrated);
    }, timeoutMs);
    unsub = usePosStore.subscribe((state) => {
      if (state._hydrated) {
        window.clearTimeout(timeoutId);
        unsub?.();
        resolve(true);
      }
    });
  });
}

async function runHydrateAccountFromCloud(opts?: {
  forcePull?: boolean;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  if (!hasSupabaseConfig) return;

  await waitForPosStoreHydrated();

  const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
  await hydrateLocalShopProfileFromCloud().catch(() => undefined);

  const localEmpty = isLocalShopDataEmpty();
  const force = opts?.forcePull === true;

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
        runWhenIdle(() => void uploadShopCloudSnapshot().catch(() => false), isNativeApp() ? 12_000 : 3000);
      }
      return;
    }
    if (force || localEmpty) {
      await pullCloudAndMergeIntoStore().catch(() => undefined);
    }
  } else if (getDeviceOnline()) {
    await syncShopWithCloud({ pull: false }).catch(() => undefined);
  }

  if (getDeviceOnline() && (force || localEmpty)) {
    await pushShopPendingToCloud().catch(() => undefined);
    runWhenIdle(() => void uploadShopCloudSnapshot().catch(() => false), isNativeApp() ? 12_000 : 3000);
  }
}

/**
 * After sign-in: restore cloud snapshot when local data is empty, else light push-only sync.
 * Debounced so duplicate auth callbacks do not stack heavy work and freeze the UI.
 */
export async function hydrateAccountFromCloud(opts?: {
  forcePull?: boolean;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  if (!hasSupabaseConfig) return;
  if (shouldPausePosBackgroundWork()) return;

  const force = opts?.forcePull === true;
  const minGap = force ? HYDRATE_FORCE_COOLDOWN_MS : HYDRATE_COOLDOWN_MS;
  if (!force && Date.now() - lastHydrateFinishedAt < minGap) return;
  if (hydrateInFlight) return hydrateInFlight;

  hydrateInFlight = runHydrateAccountFromCloud(opts)
    .catch(() => undefined)
    .finally(() => {
      lastHydrateFinishedAt = Date.now();
      hydrateInFlight = null;
    });

  return hydrateInFlight;
}
