import type { StaffAccount } from "../types";
import {
  importLocalStaffToCloud,
  pullShopStaffFromCloud,
} from "./shopStaffCloud";

function staffUpdatedAtMs(staff: StaffAccount): number {
  return Date.parse(staff.updatedAt || staff.createdAt) || 0;
}

/** Cloud wins on conflict; prefer newer updatedAt when both exist locally and in cloud. */
export function pickNewerStaffAccount(local: StaffAccount, cloud: StaffAccount): StaffAccount {
  const localMs = staffUpdatedAtMs(local);
  const cloudMs = staffUpdatedAtMs(cloud);
  if (localMs !== cloudMs) return cloudMs >= localMs ? cloud : local;
  return cloud;
}

/**
 * Additive staff merge — cloud is authoritative for approved devices.
 * Local-only staff kept until explicit owner delete or cloud confirms removal.
 */
export function mergeStaffAccountsForCloudSync(
  local: StaffAccount[],
  cloud: StaffAccount[],
): StaffAccount[] {
  const cloudById = new Map(cloud.map((row) => [row.id, row]));
  const merged = new Map<string, StaffAccount>();

  for (const cloudRow of cloud) {
    const localRow = local.find((row) => row.id === cloudRow.id);
    if (localRow) {
      merged.set(cloudRow.id, {
        ...pickNewerStaffAccount(localRow, cloudRow),
        pendingCloudSync: false,
      });
    } else {
      merged.set(cloudRow.id, { ...cloudRow, pendingCloudSync: false });
    }
  }

  for (const localRow of local) {
    if (cloudById.has(localRow.id)) continue;
    merged.set(localRow.id, localRow);
  }

  return [...merged.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function reconcileLocalOnlyStaffToCloud(cloud: StaffAccount[], merged: StaffAccount[]): Promise<void> {
  const cloudIds = new Set(cloud.map((row) => row.id));
  for (const row of merged) {
    if (!cloudIds.has(row.id) && row.pendingCloudSync !== false) {
      const { enqueuePendingStaffSync } = await import("./staffSyncQueue");
      await enqueuePendingStaffSync({ action: "create", staff: row });
    }
  }
}

const STAFF_SYNC_MIN_INTERVAL_MS = 45_000;
let lastStaffSyncAt = 0;

/** Event-driven staff pulls bypass the routine safety throttle (Phase 25.1). */
export function isEventDrivenStaffPull(reason?: string): boolean {
  if (!reason) return false;
  return (
    reason === "staff_ack" ||
    reason === "staff_realtime" ||
    reason === "realtime" ||
    reason === "reconnect" ||
    reason === "foreground" ||
    reason === "visibility" ||
    reason === "sale_ack"
  );
}

/** Pull staff during cloud sync — versioned cache on all devices. */
export async function pullAndMergeStaffDuringCloudSync(opts?: {
  deviceAuthority?: import("./deviceAuthority").DeviceAuthorityContext | null;
  force?: boolean;
  reason?: string;
}): Promise<void> {
  const now = Date.now();
  const eventDriven = opts?.force === true || isEventDrivenStaffPull(opts?.reason);
  if (opts?.reason === "staff_realtime") {
    void import("./staffSyncDiagnostics").then(({ consumeStaffRealtimeToPullLatency }) => {
      consumeStaffRealtimeToPullLatency();
    });
  }
  if (!eventDriven && now - lastStaffSyncAt < STAFF_SYNC_MIN_INTERVAL_MS) return;

  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx) return;

  const {
    refreshStaffCacheBackground,
    isStaffCacheUpToDate,
    reconcileStaffCacheToPreferencesIfNeeded,
  } = await import("./staffCacheSync");

  const updated = await refreshStaffCacheBackground({ force: eventDriven });
  if (updated) {
    const { usePosStore } = await import("../store/usePosStore");
    const { readOfflineStaffCache } = await import("./offlineStaffCache");
    const cache = await readOfflineStaffCache(ctx.shopId);
    const merged = usePosStore.getState().preferences.staffAccounts ?? [];
    await reconcileLocalOnlyStaffToCloud(cache?.staff ?? [], merged);
    lastStaffSyncAt = now;
    return;
  }

  if (await isStaffCacheUpToDate(ctx.shopId)) {
    await reconcileStaffCacheToPreferencesIfNeeded(ctx.shopId);
    lastStaffSyncAt = now;
    return;
  }

  let cloud = await pullShopStaffFromCloud();
  if (cloud === null) return;

  const { usePosStore } = await import("../store/usePosStore");
  const state = usePosStore.getState();
  const local = state.preferences.staffAccounts ?? [];

  if (cloud.length === 0 && local.length > 0) {
    await importLocalStaffToCloud(ctx.shopId, local);
    const repulled = await pullShopStaffFromCloud();
    if (repulled) cloud = repulled;
  }

  const { applyStaffAccountsMergeToStore, computeImplicitStaffTombstones } = await import("./staffSyncApply");
  const removedIds = computeImplicitStaffTombstones(local, cloud);
  await applyStaffAccountsMergeToStore(cloud, { source: "cloud_pull", removedIds });
  const merged = usePosStore.getState().preferences.staffAccounts ?? [];

  await reconcileLocalOnlyStaffToCloud(cloud, merged);
  await refreshStaffCacheBackground({ force: true });
  lastStaffSyncAt = now;
}

/** Force staff list hydration from cloud/cache — validates against cloud even when local staff exist. */
export async function hydrateStaffTeamFromCloud(opts?: { force?: boolean }): Promise<number> {
  const hydrateStarted = performance.now();
  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx) return 0;

  const force = opts?.force ?? false;
  const {
    refreshStaffCacheBackground,
    reconcileStaffCacheToPreferencesIfNeeded,
  } = await import("./staffCacheSync");

  await refreshStaffCacheBackground({ force: force || undefined });
  await reconcileStaffCacheToPreferencesIfNeeded(ctx.shopId);

  const { readOfflineStaffCache } = await import("./offlineStaffCache");
  const cache = await readOfflineStaffCache(ctx.shopId);
  if (!cache?.staff.length) {
    const count = await pullAndMergeStaffAccountsForRecovery();
    const { recordStaffHydrationDuration } = await import("./staffSyncDiagnostics");
    recordStaffHydrationDuration(performance.now() - hydrateStarted, { force, count });
    return count;
  }

  const { usePosStore } = await import("../store/usePosStore");
  const count = (usePosStore.getState().preferences.staffAccounts ?? []).length;
  const { recordStaffHydrationDuration } = await import("./staffSyncDiagnostics");
  recordStaffHydrationDuration(performance.now() - hydrateStarted, { force, count });
  return count;
}

export async function pullAndMergeStaffAccountsForRecovery(): Promise<number> {
  const { refreshStaffCacheBackground } = await import("./staffCacheSync");
  await refreshStaffCacheBackground({ force: true });
  const { readOfflineStaffCache } = await import("./offlineStaffCache");
  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx) return 0;
  const cache = await readOfflineStaffCache(ctx.shopId);
  const { applyStaffAccountsMergeToStore, computeImplicitStaffTombstones } = await import("./staffSyncApply");

  if (!cache?.staff.length) {
    const pulled = await pullShopStaffFromCloud();
    if (!pulled?.length) return 0;
    const { usePosStore } = await import("../store/usePosStore");
    const local = usePosStore.getState().preferences.staffAccounts ?? [];
    const removedIds = computeImplicitStaffTombstones(local, pulled);
    await applyStaffAccountsMergeToStore(pulled, { source: "recovery_cloud_pull", removedIds });
    return (usePosStore.getState().preferences.staffAccounts ?? []).length;
  }

  const { usePosStore } = await import("../store/usePosStore");
  const local = usePosStore.getState().preferences.staffAccounts ?? [];
  const removedIds = computeImplicitStaffTombstones(local, cache.staff);
  await applyStaffAccountsMergeToStore(cache.staff, { source: "recovery_cache", removedIds });
  return (usePosStore.getState().preferences.staffAccounts ?? []).length;
}
