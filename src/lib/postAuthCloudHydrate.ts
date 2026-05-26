import { Capacitor } from "@capacitor/core";
import { hasSupabaseConfig } from "./supabase";

/** After sign-in on a new device, pull shop profile and inventory from Supabase. */
export async function hydrateAccountFromCloud(opts?: { forcePull?: boolean }): Promise<void> {
  if (!hasSupabaseConfig) return;

  const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
  await hydrateLocalShopProfileFromCloud().catch(() => undefined);

  const { pullCloudAndMergeIntoStore, syncShopWithCloud } = await import("../offline/cloudSync");
  if (opts?.forcePull || Capacitor.isNativePlatform()) {
    await pullCloudAndMergeIntoStore().catch(() => undefined);
  } else {
    await syncShopWithCloud({ pull: true }).catch(() => undefined);
  }
}
