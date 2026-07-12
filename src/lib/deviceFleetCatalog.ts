import {
  isLicensedActiveDevice,
  isPendingApprovalDevice,
  type ShopDeviceRow,
} from "./shopDevices";
import { resolveDevicePresence, type DevicePresenceState } from "./deviceFleetPresence";

export type DeviceFleetBucket =
  | "current"
  | "approved"
  | "pending"
  | "offline"
  | "disconnected"
  | "revoked";

export type DeviceFleetFilter =
  | "all"
  | "online"
  | "offline"
  | "pending"
  | "approved"
  | "revoked"
  | "disconnected"
  | "current"
  | "android"
  | "windows"
  | "web"
  | "ios";

export function resolveDeviceFleetBucket(
  device: ShopDeviceRow,
  currentFingerprint: string,
  nowMs: number = Date.now(),
): DeviceFleetBucket {
  if (device.device_fingerprint === currentFingerprint) return "current";
  if (isPendingApprovalDevice(device)) return "pending";
  if (device.approval_status === "revoked" || device.status === "revoked") return "revoked";
  if (device.status === "disconnected") return "disconnected";
  if (device.approval_status === "suspended" || device.approval_status === "disabled") {
    return "revoked";
  }
  if (isLicensedActiveDevice(device)) {
    const presence = resolveDevicePresence(device, nowMs);
    if (presence === "offline" || presence === "unknown") return "offline";
    return "approved";
  }
  return "disconnected";
}

export function normalizePlatformFilter(platform: string | null | undefined): string {
  const p = (platform ?? "").trim().toLowerCase();
  if (p === "electron" || p === "win32") return "windows";
  return p;
}

export function deviceMatchesFleetFilter(
  device: ShopDeviceRow,
  filter: DeviceFleetFilter,
  currentFingerprint: string,
  nowMs: number,
): boolean {
  if (filter === "all") return true;
  if (filter === "current") return device.device_fingerprint === currentFingerprint;
  if (filter === "pending") return isPendingApprovalDevice(device);
  if (filter === "approved") return isLicensedActiveDevice(device);
  if (filter === "revoked") {
    return device.approval_status === "revoked" || device.status === "revoked";
  }
  if (filter === "disconnected") return device.status === "disconnected";
  if (filter === "online") {
    return resolveDevicePresence(device, nowMs) === "online";
  }
  if (filter === "offline") {
    const presence = resolveDevicePresence(device, nowMs);
    return presence === "offline" || presence === "recently_active" || presence === "unknown";
  }
  if (filter === "android" || filter === "windows" || filter === "web" || filter === "ios") {
    return normalizePlatformFilter(device.platform) === filter;
  }
  return true;
}

export function deviceMatchesFleetSearch(device: ShopDeviceRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    device.label,
    device.platform,
    device.device_fingerprint,
    device.id,
    device.app_version,
    device.current_staff_client_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function filterFleetDevices(
  devices: ShopDeviceRow[],
  opts: {
    filter: DeviceFleetFilter;
    search: string;
    currentFingerprint: string;
    nowMs?: number;
  },
): ShopDeviceRow[] {
  const nowMs = opts.nowMs ?? Date.now();
  return devices.filter(
    (device) =>
      deviceMatchesFleetFilter(device, opts.filter, opts.currentFingerprint, nowMs) &&
      deviceMatchesFleetSearch(device, opts.search),
  );
}

export function groupFleetDevicesByBucket(
  devices: ShopDeviceRow[],
  currentFingerprint: string,
  nowMs: number = Date.now(),
): Record<DeviceFleetBucket, ShopDeviceRow[]> {
  const buckets: Record<DeviceFleetBucket, ShopDeviceRow[]> = {
    current: [],
    approved: [],
    pending: [],
    offline: [],
    disconnected: [],
    revoked: [],
  };
  for (const device of devices) {
    buckets[resolveDeviceFleetBucket(device, currentFingerprint, nowMs)].push(device);
  }
  return buckets;
}

export function presenceLabelKey(presence: DevicePresenceState): string {
  switch (presence) {
    case "online":
      return "deviceFleetPresenceOnline";
    case "recently_active":
      return "deviceFleetPresenceRecent";
    case "offline":
      return "deviceFleetPresenceOffline";
    default:
      return "deviceFleetPresenceUnknown";
  }
}

export type DeviceTimelineEntry = {
  id: string;
  labelKey: string;
  at: string | null;
};

export function buildDeviceTimeline(device: ShopDeviceRow): DeviceTimelineEntry[] {
  return [
    { id: "registered", labelKey: "deviceFleetTimelineRegistered", at: device.created_at || null },
    {
      id: "approved",
      labelKey: "deviceFleetTimelineApproved",
      at: device.approval_status === "approved" ? device.created_at || null : null,
    },
    { id: "last_login", labelKey: "deviceFleetTimelineLastLogin", at: device.last_login_at },
    { id: "last_sync", labelKey: "deviceFleetTimelineLastSync", at: device.last_sync_at },
    { id: "last_activity", labelKey: "deviceFleetTimelineLastActivity", at: device.last_seen_at },
  ];
}
