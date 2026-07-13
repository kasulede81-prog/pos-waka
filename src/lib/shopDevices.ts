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
  const totalCount = devices.filter((d) => isAssignableFleetDevice(d)).length;
  const atPlanLimit = planLimit != null && planLimit > 0 && activeCount >= planLimit;
  const overPlanLimit = planLimit != null && planLimit > 0 && activeCount > planLimit;
  return { activeCount, totalCount, planLimit, atPlanLimit, overPlanLimit };
}

/** Licensed slot or pending approval — excludes disconnected/revoked history. */
export function isAssignableFleetDevice(device: ShopDeviceRow): boolean {
  return isLicensedActiveDevice(device) || isPendingApprovalDevice(device);
}

function deviceRecencyMs(device: ShopDeviceRow): number {
  const seen = device.last_seen_at ? Date.parse(device.last_seen_at) : Number.NaN;
  if (!Number.isNaN(seen)) return seen;
  const login = device.last_login_at ? Date.parse(device.last_login_at) : Number.NaN;
  if (!Number.isNaN(login)) return login;
  const created = Date.parse(device.created_at);
  return Number.isNaN(created) ? 0 : created;
}

/** Keep only plan-assigned devices (active licensed + pending), capped to plan limit for active slots. */
export function filterAssignableFleetDevices(
  devices: ShopDeviceRow[],
  planLimit: number | null,
  currentFingerprint?: string,
): ShopDeviceRow[] {
  const assignable = devices.filter(isAssignableFleetDevice);
  const pending = assignable.filter(isPendingApprovalDevice);
  let active = assignable
    .filter(isLicensedActiveDevice)
    .sort((a, b) => deviceRecencyMs(b) - deviceRecencyMs(a));

  if (planLimit != null && planLimit > 0 && active.length > planLimit) {
    const keep = active.slice(0, planLimit);
    const current = currentFingerprint
      ? active.find((d) => d.device_fingerprint === currentFingerprint)
      : undefined;
    if (current && !keep.some((d) => d.id === current.id)) {
      keep[keep.length - 1] = current;
    }
    active = keep;
  }

  return [...active, ...pending];
}

function normalizeRpcDeviceList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.devices)) return record.devices;
  }
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        if (Array.isArray(record.devices)) return record.devices;
      }
    } catch {
      return [];
    }
  }
  return [];
}

function parseDeviceRows(data: unknown): ShopDeviceRow[] {
  const rows = normalizeRpcDeviceList(data);
  return rows
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

const SHOP_DEVICES_TABLE_SELECT =
  "id,device_fingerprint,label,platform,app_version,last_seen_at,last_sync_at,last_login_at,is_active,status,device_authority,approval_status,approval_requested_at,form_factor,device_type,is_primary,current_staff_client_id,pending_uploads,pending_downloads,cloud_status,recovery_status,created_at";

async function fetchShopDevicesDirect(shopId: string): Promise<ShopDeviceRow[]> {
  if (!supabase || !shopId) return [];
  const { data, error } = await supabase
    .from("shop_devices")
    .select(SHOP_DEVICES_TABLE_SELECT)
    .eq("shop_id", shopId)
    .or("and(status.eq.active,approval_status.eq.approved),approval_status.eq.pending")
    .order("last_seen_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return parseDeviceRows(data ?? []);
}

function finalizeFleetDeviceRows(
  devices: ShopDeviceRow[],
  planLimit: number | null,
  currentFingerprint?: string,
): ShopDeviceRow[] {
  return filterAssignableFleetDevices(devices, planLimit, currentFingerprint);
}

export async function fetchOwnerShopDevices(
  shopId: string,
  opts?: { planLimit?: number | null; currentFingerprint?: string },
): Promise<ShopDeviceRow[]> {
  if (!supabase || !shopId) return [];
  const planLimit = opts?.planLimit ?? null;
  const currentFingerprint = opts?.currentFingerprint;

  let rpcFailure: unknown = null;
  try {
    const { data, error } = await supabase.rpc("owner_list_shop_devices", { p_shop_id: shopId });
    if (error) {
      rpcFailure = error;
    } else {
      const parsed = parseDeviceRows(data);
      if (parsed.length > 0) {
        return finalizeFleetDeviceRows(parsed, planLimit, currentFingerprint);
      }
    }
  } catch (e) {
    rpcFailure = e;
  }

  try {
    const direct = await fetchShopDevicesDirect(shopId);
    if (direct.length > 0) {
      console.info("[waka-devices] loaded fleet via shop_devices table fallback", { shopId, count: direct.length });
      return finalizeFleetDeviceRows(direct, planLimit, currentFingerprint);
    }
  } catch (e) {
    console.warn("[waka-devices] direct shop_devices query failed", e);
    if (rpcFailure) throw rpcFailure;
    throw e;
  }

  if (rpcFailure) {
    const msg = (rpcFailure instanceof Error ? rpcFailure.message : String(rpcFailure)).toLowerCase();
    if (msg.includes("forbidden")) return [];
    throw rpcFailure;
  }
  return [];
}

export type ShopDevicesManagementLoad = {
  devices: ShopDeviceRow[];
  isOwner: boolean;
};

/** Owner list includes pending devices; staff without owner role cannot manage approvals. */
export async function fetchShopDevicesForManagement(
  shopId: string,
  opts?: { planLimit?: number | null; currentFingerprint?: string },
): Promise<ShopDevicesManagementLoad> {
  let isOwner = false;
  let planLimit = opts?.planLimit ?? null;
  try {
    const { fetchShopDeviceLimitContext } = await import("./deviceActivation");
    const ctx = await fetchShopDeviceLimitContext(shopId);
    isOwner = ctx?.is_owner ?? false;
    if (planLimit == null && ctx?.device_limit != null) {
      planLimit = ctx.device_limit;
    }
  } catch {
    // Degrade gracefully — device rows may still load via table fallback.
  }

  try {
    const devices = await fetchOwnerShopDevices(shopId, {
      planLimit,
      currentFingerprint: opts?.currentFingerprint,
    });
    return { devices, isOwner };
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
  try {
    const { error } = await supabase.rpc("owner_record_devices_viewed", {
      p_shop_id: shopId,
      p_device_fingerprint: fp,
    });
    if (error) {
      console.warn("[waka-devices] record_devices_viewed", error.message);
    }
  } catch (e) {
    console.warn("[waka-devices] record_devices_viewed", e);
  }
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
