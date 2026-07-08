import type { ShopDeviceRow } from "./wakaInternalAdmin";

/** Device seen online within this window counts as logged in. */
export const RESCUE_DEVICE_ONLINE_MS = 15 * 60 * 1000;

/** Max devices shown in rescue console active list (typical shop plan limit). */
export const RESCUE_ACTIVE_DEVICE_LIMIT = 4;

export function isRescueDeviceOnline(lastSeen: string | null | undefined, nowMs = Date.now()): boolean {
  if (!lastSeen) return false;
  const ts = Date.parse(lastSeen);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts < RESCUE_DEVICE_ONLINE_MS;
}

export function isRescueDeviceLoggedIn(device: ShopDeviceRow, nowMs = Date.now()): boolean {
  if (!device.is_active) return false;
  if (isRescueDeviceOnline(device.last_seen_at, nowMs)) return true;
  if (device.last_login_at) {
    const loginTs = Date.parse(device.last_login_at);
    if (Number.isFinite(loginTs) && nowMs - loginTs < 24 * 60 * 60 * 1000) return true;
  }
  return false;
}

export function sortRescueDevices(devices: ShopDeviceRow[]): ShopDeviceRow[] {
  return [...devices].sort((a, b) => {
    const aPrimary = a.device_authority === "primary" ? 1 : 0;
    const bPrimary = b.device_authority === "primary" ? 1 : 0;
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;
    const aSeen = a.last_seen_at ? Date.parse(a.last_seen_at) : 0;
    const bSeen = b.last_seen_at ? Date.parse(b.last_seen_at) : 0;
    return bSeen - aSeen;
  });
}

export function filterActiveRescueDevices(
  devices: ShopDeviceRow[],
  opts?: { limit?: number; nowMs?: number },
): ShopDeviceRow[] {
  const limit = opts?.limit ?? RESCUE_ACTIVE_DEVICE_LIMIT;
  const nowMs = opts?.nowMs ?? Date.now();
  return sortRescueDevices(devices.filter((d) => isRescueDeviceLoggedIn(d, nowMs))).slice(0, limit);
}
