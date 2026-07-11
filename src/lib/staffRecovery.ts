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
 * Additive staff merge — cloud is authoritative (primary device only).
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

export function mergeStaffAccountsFromCloudPull(local: StaffAccount[], cloud: StaffAccount[]): StaffAccount[] {
  return mergeStaffAccountsForCloudSync(local, cloud);
}

function staffAccountsEqual(a: StaffAccount[], b: StaffAccount[]): boolean {
  if (a.length !== b.length) return false;
  const sortKey = (row: StaffAccount) =>
    `${row.id}:${row.updatedAt}:${row.active}:${row.name}:${row.pendingCloudSync ? 1 : 0}`;
  const left = [...a].map(sortKey).sort();
  const right = [...b].map(sortKey).sort();
  return left.every((value, index) => value === right[index]);
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

/** Pull staff during cloud sync — Phase 3 uses versioned cache on all devices. */
export async function pullAndMergeStaffDuringCloudSync(opts?: {
  deviceAuthority?: import("./deviceAuthority").DeviceAuthorityContext | null;
  force?: boolean;
}): Promise<void> {
  const now = Date.now();
  if (!opts?.force && now - lastStaffSyncAt < STAFF_SYNC_MIN_INTERVAL_MS) return;

  const {
    refreshStaffCacheBackground,
    isStaffCacheUpToDate,
  } = await import("./staffCacheSync");

  const updated = await refreshStaffCacheBackground();
  if (updated) {
    lastStaffSyncAt = now;
    return;
  }

  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx) return;

  if (await isStaffCacheUpToDate(ctx.shopId)) {
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

  const merged = mergeStaffAccountsForCloudSync(local, cloud);
  if (!staffAccountsEqual(local, merged)) {
    usePosStore.setState({
      preferences: { ...state.preferences, staffAccounts: merged },
    });
  }

  await reconcileLocalOnlyStaffToCloud(cloud, merged);
  await refreshStaffCacheBackground({ force: true });
  lastStaffSyncAt = now;
}

export async function pullAndMergeStaffAccountsForRecovery(): Promise<number> {
  const { refreshStaffCacheBackground } = await import("./staffCacheSync");
  await refreshStaffCacheBackground({ force: true });
  const { readOfflineStaffCache } = await import("./offlineStaffCache");
  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx) return 0;
  const cache = await readOfflineStaffCache(ctx.shopId);
  if (!cache?.staff.length) {
    const pulled = await pullShopStaffFromCloud();
    if (!pulled?.length) return 0;
    const { usePosStore } = await import("../store/usePosStore");
    const state = usePosStore.getState();
    const merged = mergeStaffAccountsForCloudSync(state.preferences.staffAccounts ?? [], pulled);
    usePosStore.setState({
      preferences: { ...state.preferences, staffAccounts: merged },
    });
    return merged.length;
  }
  const { mirrorStaffCacheToPreferences } = await import("./staffCacheSync");
  mirrorStaffCacheToPreferences(cache.staff);
  return cache.staff.length;
}
