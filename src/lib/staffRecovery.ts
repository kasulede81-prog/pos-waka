import type { StaffAccount } from "../types";
import {
  importLocalStaffToCloud,
  pullShopStaffFromCloud,
  pushStaffToCloud,
} from "./shopStaffCloud";

/** Grace period for local-only staff not yet visible in cloud (push in flight / offline create). */
export const STAFF_PENDING_PUSH_GRACE_MS = 120_000;

function staffUpdatedAtMs(staff: StaffAccount): number {
  return Date.parse(staff.updatedAt || staff.createdAt) || 0;
}

export function pickNewerStaffAccount(local: StaffAccount, cloud: StaffAccount): StaffAccount {
  const localMs = staffUpdatedAtMs(local);
  const cloudMs = staffUpdatedAtMs(cloud);
  if (localMs !== cloudMs) return localMs >= cloudMs ? local : cloud;
  return cloud;
}

/** Merge cloud staff into local; cloud membership is authoritative except very recent local-only rows. */
export function mergeStaffAccountsForCloudSync(
  local: StaffAccount[],
  cloud: StaffAccount[],
  opts?: { nowMs?: number; pendingGraceMs?: number },
): StaffAccount[] {
  const nowMs = opts?.nowMs ?? Date.now();
  const pendingGraceMs = opts?.pendingGraceMs ?? STAFF_PENDING_PUSH_GRACE_MS;
  const cloudById = new Map(cloud.map((row) => [row.id, row]));
  const merged = new Map<string, StaffAccount>();

  for (const cloudRow of cloud) {
    const localRow = local.find((row) => row.id === cloudRow.id);
    merged.set(cloudRow.id, localRow ? pickNewerStaffAccount(localRow, cloudRow) : cloudRow);
  }

  for (const localRow of local) {
    if (cloudById.has(localRow.id)) continue;
    if (nowMs - staffUpdatedAtMs(localRow) <= pendingGraceMs) {
      merged.set(localRow.id, localRow);
    }
  }

  return [...merged.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function mergeStaffAccountsFromCloudPull(local: StaffAccount[], cloud: StaffAccount[]): StaffAccount[] {
  return mergeStaffAccountsForCloudSync(local, cloud, { pendingGraceMs: Number.POSITIVE_INFINITY });
}

function staffAccountsEqual(a: StaffAccount[], b: StaffAccount[]): boolean {
  if (a.length !== b.length) return false;
  const sortKey = (row: StaffAccount) => `${row.id}:${row.updatedAt}:${row.active}:${row.name}`;
  const left = [...a].map(sortKey).sort();
  const right = [...b].map(sortKey).sort();
  return left.every((value, index) => value === right[index]);
}

async function reconcileLocalOnlyStaffToCloud(cloud: StaffAccount[], merged: StaffAccount[]): Promise<void> {
  const cloudIds = new Set(cloud.map((row) => row.id));
  for (const row of merged) {
    if (!cloudIds.has(row.id)) {
      await pushStaffToCloud(row);
    }
  }
}

/** Pull staff during regular cloud sync and merge into preferences. */
export async function pullAndMergeStaffDuringCloudSync(): Promise<void> {
  let cloud = await pullShopStaffFromCloud();
  if (cloud === null) return;

  const { usePosStore } = await import("../store/usePosStore");
  const state = usePosStore.getState();
  const local = state.preferences.staffAccounts ?? [];

  if (cloud.length === 0 && local.length > 0) {
    const { resolveShopCtx } = await import("../offline/cloudSync");
    const ctx = await resolveShopCtx();
    if (ctx) {
      await importLocalStaffToCloud(ctx.shopId, local);
      const repulled = await pullShopStaffFromCloud();
      if (repulled) cloud = repulled;
    }
  }

  const merged = mergeStaffAccountsForCloudSync(local, cloud);
  if (!staffAccountsEqual(local, merged)) {
    usePosStore.setState({
      preferences: { ...state.preferences, staffAccounts: merged },
    });
  }

  await reconcileLocalOnlyStaffToCloud(cloud, merged);
}

export async function pullAndMergeStaffAccountsForRecovery(): Promise<number> {
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
