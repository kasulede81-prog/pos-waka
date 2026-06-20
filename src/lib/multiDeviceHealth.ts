/**
 * Multi-device system health snapshot for owner dashboard.
 */

import type { ShopDeviceRow } from "./shopDevices";
import { listSyncConflicts } from "./syncConflictLog";
import { readSyncCheckpoints } from "./syncCheckpoints";
import { getOrCreateDeviceId } from "./deviceId";
import { readSyncQueue } from "../offline/localDb";

export type MultiDeviceHealthSnapshot = {
  at: string;
  thisDeviceFingerprint: string;
  activeDevices: number;
  devices: Array<{
    id: string;
    label: string;
    platform: string | null;
    lastSeenAt: string | null;
    status: string;
    isThisDevice: boolean;
  }>;
  pendingQueueOps: number;
  lastSalesSyncAt: string | null;
  lastProductsSyncAt: string | null;
  bootstrapComplete: boolean;
  unacknowledgedConflicts: number;
  staleDeviceCount: number;
  lastInventoryCountSessionsSyncAt: string | null;
  lastShiftsSyncAt: string | null;
  lastDayClosesSyncAt: string | null;
};

const STALE_MS = 24 * 60 * 60 * 1000;

export async function buildMultiDeviceHealthSnapshot(
  devices: ShopDeviceRow[],
): Promise<MultiDeviceHealthSnapshot> {
  const fp = getOrCreateDeviceId();
  const now = Date.now();
  const queue = await readSyncQueue();
  const cp = readSyncCheckpoints();
  const conflicts = listSyncConflicts({ unacknowledgedOnly: true });

  const active = devices.filter((d) => d.status === "active");
  const staleDeviceCount = active.filter((d) => {
    if (!d.last_seen_at) return true;
    return now - Date.parse(d.last_seen_at) > STALE_MS;
  }).length;

  return {
    at: new Date().toISOString(),
    thisDeviceFingerprint: fp,
    activeDevices: active.length,
    devices: devices.map((d) => ({
      id: d.id,
      label: d.label ?? d.platform ?? "Device",
      platform: d.platform,
      lastSeenAt: d.last_seen_at,
      status: d.status,
      isThisDevice: d.device_fingerprint === fp,
    })),
    pendingQueueOps: queue.length,
    lastSalesSyncAt: cp.lastSalesSyncAt,
    lastProductsSyncAt: cp.lastProductsSyncAt,
    bootstrapComplete: cp.bootstrapComplete,
    unacknowledgedConflicts: conflicts.length,
    staleDeviceCount,
    lastInventoryCountSessionsSyncAt: cp.lastInventoryCountSessionsSyncAt,
    lastShiftsSyncAt: cp.lastShiftsSyncAt,
    lastDayClosesSyncAt: cp.lastDayClosesSyncAt,
  };
}
