import { getOrCreateDeviceId } from "./deviceId";
import { appendDeviceAuditEntry } from "./deviceAudit";
import { isActiveDeviceStatus, normalizeShopDeviceStatus, type ShopDeviceStatus } from "./deviceLifecycle";
import { supabase } from "./supabase";
import { resolveEffectiveDeviceLimit } from "./effectiveSubscription";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";

export type ShopDeviceRow = {
  id: string;
  device_fingerprint: string;
  label: string | null;
  platform: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  last_sync_at: string | null;
  last_login_at: string | null;
  status: ShopDeviceStatus;
  is_active: boolean;
  created_at: string;
  device_authority: "primary" | "secondary";
  approval_status: "pending" | "approved" | "suspended" | "revoked" | "disabled";
  approval_requested_at: string | null;
  form_factor: "tablet" | "phone" | "windows" | "kitchen" | "bar";
  device_type: string | null;
  is_primary: boolean;
  current_staff_client_id: string | null;
  pending_uploads: number;
  pending_downloads: number;
  cloud_status: string | null;
  recovery_status: string | null;
};

export type { ShopDeviceStatus };

export type DeviceUsageSummary = {
  activeCount: number;
  totalCount: number;
  planLimit: number | null;
  atPlanLimit: boolean;
  /** More active devices than plan allows (grandfathered before enforcement). */
  overPlanLimit: boolean;
};

/** Plan device cap — uses enterprise effective subscription resolver (Phase 16.4). */
export function parsePlanDeviceLimit(snapshot: SubscriptionSnapshot, authMode: "supabase" | "local"): number | null {
  return resolveEffectiveDeviceLimit(snapshot, authMode);
}

/** Licensed slot: approved and active (consumes subscription device limit). */
export function isLicensedActiveDevice(device: ShopDeviceRow): boolean {
  return isActiveDeviceStatus(device.status) && device.approval_status === "approved";
}

export function isPendingApprovalDevice(device: ShopDeviceRow): boolean {
  return device.approval_status === "pending";
}

export function isDeviceHistoryRecord(device: ShopDeviceRow): boolean {
  return !isLicensedActiveDevice(device) && !isPendingApprovalDevice(device);
}

export function partitionShopDevices(devices: ShopDeviceRow[]): {
  activeDevices: ShopDeviceRow[];
  pendingDevices: ShopDeviceRow[];
  historyDevices: ShopDeviceRow[];
} {
  const activeDevices: ShopDeviceRow[] = [];
  const pendingDevices: ShopDeviceRow[] = [];
  const historyDevices: ShopDeviceRow[] = [];
  for (const device of devices) {
    if (isLicensedActiveDevice(device)) activeDevices.push(device);
    else if (isPendingApprovalDevice(device)) pendingDevices.push(device);
    else historyDevices.push(device);
  }
  return { activeDevices, pendingDevices, historyDevices };
}

export function buildDeviceUsageSummary(
  devices: ShopDeviceRow[],
  planLimit: number | null,
): DeviceUsageSummary {
  const activeCount = devices.filter((d) => isLicensedActiveDevice(d)).length;
  const totalCount = devices.length;
  const atPlanLimit = planLimit != null && planLimit > 0 && activeCount >= planLimit;
  const overPlanLimit = planLimit != null && planLimit > 0 && activeCount > planLimit;
  return { activeCount, totalCount, planLimit, atPlanLimit, overPlanLimit };
}

function parseDeviceRows(data: unknown): ShopDeviceRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? "");
      if (!id) return null;
      return {
        id,
        device_fingerprint: String(r.device_fingerprint ?? ""),
        label: r.label != null ? String(r.label) : null,
        platform: r.platform != null ? String(r.platform) : null,
        app_version: r.app_version != null ? String(r.app_version) : null,
        last_seen_at: r.last_seen_at != null ? String(r.last_seen_at) : null,
        last_sync_at: r.last_sync_at != null ? String(r.last_sync_at) : null,
        last_login_at: r.last_login_at != null ? String(r.last_login_at) : null,
        status: normalizeShopDeviceStatus(
          r.status ?? (r.is_active === false ? "disconnected" : "active"),
        ),
        is_active: Boolean(r.is_active),
        created_at: String(r.created_at ?? ""),
        device_authority: r.device_authority === "primary" ? "primary" : "secondary",
        approval_status: normalizeApprovalStatus(r.approval_status),
        approval_requested_at: r.approval_requested_at != null ? String(r.approval_requested_at) : null,
        form_factor: normalizeFormFactor(r.form_factor),
        device_type: r.device_type != null ? String(r.device_type) : null,
        is_primary: r.is_primary === true || r.device_authority === "primary",
        current_staff_client_id:
          r.current_staff_client_id != null ? String(r.current_staff_client_id) : null,
        pending_uploads: Number(r.pending_uploads ?? 0) || 0,
        pending_downloads: Number(r.pending_downloads ?? 0) || 0,
        cloud_status: r.cloud_status != null ? String(r.cloud_status) : null,
        recovery_status: r.recovery_status != null ? String(r.recovery_status) : null,
      };
    })
    .filter((d): d is ShopDeviceRow => d != null);
}

export async function fetchOwnerShopDevices(shopId: string): Promise<ShopDeviceRow[]> {
  if (!supabase || !shopId) return [];
  const { data, error } = await supabase.rpc("owner_list_shop_devices", { p_shop_id: shopId });
  if (error) throw error;
  return parseDeviceRows(data);
}

export type ShopDevicesManagementLoad = {
  devices: ShopDeviceRow[];
  isOwner: boolean;
};

/** Owner list includes pending devices; staff without owner role cannot manage approvals. */
export async function fetchShopDevicesForManagement(shopId: string): Promise<ShopDevicesManagementLoad> {
  try {
    const devices = await fetchOwnerShopDevices(shopId);
    return { devices, isOwner: true };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
    if (msg.includes("forbidden")) {
      return { devices: [], isOwner: false };
    }
    throw e;
  }
}

export async function disconnectOwnerShopDevice(deviceId: string, shopId: string): Promise<void> {
  if (!supabase) throw new Error("Cloud not configured");
  const { error } = await supabase.rpc("owner_disconnect_shop_device", { p_device_id: deviceId });
  if (error) throw error;
  appendDeviceAuditEntry("device_disconnected", "Disconnected a shop device", {
    shopId,
    deviceId,
    deviceFingerprint: getOrCreateDeviceId(),
  });
}

export async function dismissPendingOwnerShopDevice(deviceId: string, shopId: string): Promise<void> {
  if (!supabase) throw new Error("Cloud not configured");
  const { data, error } = await supabase.rpc("owner_dismiss_pending_shop_device", { p_device_id: deviceId });
  if (error) throw error;
  const payload = data as { ok?: boolean; error?: string } | null;
  if (payload?.ok !== true) {
    throw new Error(payload?.error ?? "dismiss_failed");
  }
  appendDeviceAuditEntry("device_pending_dismissed", "Dismissed pending device request", {
    shopId,
    deviceId,
    deviceFingerprint: getOrCreateDeviceId(),
  });
}

export async function removeOwnerShopDevice(deviceId: string, shopId: string): Promise<void> {
  if (!supabase) throw new Error("Cloud not configured");
  const { data, error } = await supabase.rpc("owner_remove_shop_device", { p_device_id: deviceId });
  if (error) throw error;
  const payload = data as { ok?: boolean; error?: string } | null;
  if (payload?.ok !== true) {
    throw new Error(payload?.error ?? "remove_failed");
  }
  appendDeviceAuditEntry("device_removed", "Removed a shop device", {
    shopId,
    deviceId,
    deviceFingerprint: getOrCreateDeviceId(),
  });
}

export async function recordDevicesPageViewed(shopId: string): Promise<void> {
  const fp = getOrCreateDeviceId();
  appendDeviceAuditEntry("device_viewed", "Viewed connected devices", {
    shopId,
    deviceFingerprint: fp,
  });
  if (!supabase || !shopId) return;
  await supabase.rpc("owner_record_devices_viewed", {
    p_shop_id: shopId,
    p_device_fingerprint: fp,
  });
}

export function currentDeviceFingerprint(): string {
  return getOrCreateDeviceId();
}

function normalizeApprovalStatus(raw: unknown): ShopDeviceRow["approval_status"] {
  const s = String(raw ?? "approved").toLowerCase();
  if (s === "pending" || s === "suspended" || s === "revoked" || s === "disabled") return s;
  return "approved";
}

function normalizeFormFactor(raw: unknown): ShopDeviceRow["form_factor"] {
  const s = String(raw ?? "tablet").toLowerCase();
  if (s === "phone" || s === "windows" || s === "kitchen" || s === "bar") return s;
  return "tablet";
}
