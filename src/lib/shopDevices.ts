import { getOrCreateDeviceId } from "./deviceId";
import { appendDeviceAuditEntry } from "./deviceAudit";
import { isActiveDeviceStatus, normalizeShopDeviceStatus, type ShopDeviceStatus } from "./deviceLifecycle";
import { supabase } from "./supabase";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";
import {
  normalizePlanCode,
  planDeviceLimitForTier,
  resolveEffectivePlanTier,
} from "./subscriptionEntitlements";

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

/** Plan device cap — subscription row, features JSON, or tier defaults (never unlimited on cloud). */
export function parsePlanDeviceLimit(snapshot: SubscriptionSnapshot, authMode: "supabase" | "local"): number | null {
  if (authMode === "local") return null;
  const tier = resolveEffectivePlanTier(snapshot);
  if (snapshot.kind === "remote") {
    const fromRow = snapshot.row.max_devices;
    if (fromRow != null && fromRow > 0) return fromRow;
    const fromCode = planDeviceLimitForTier(normalizePlanCode(snapshot.row.plan_code));
    if (snapshot.row.plan_code) return fromCode;
  }
  return planDeviceLimitForTier(tier);
}

export function buildDeviceUsageSummary(
  devices: ShopDeviceRow[],
  planLimit: number | null,
): DeviceUsageSummary {
  const activeCount = devices.filter(
    (d) => isActiveDeviceStatus(d.status) && d.approval_status === "approved",
  ).length;
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
