import { getOrCreateDeviceId } from "./deviceId";
import { appendDeviceAuditEntry } from "./deviceAudit";
import { isActiveDeviceStatus, normalizeShopDeviceStatus, type ShopDeviceStatus } from "./deviceLifecycle";
import { supabase } from "./supabase";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";

export type ShopDeviceRow = {
  id: string;
  device_fingerprint: string;
  label: string | null;
  platform: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  status: ShopDeviceStatus;
  is_active: boolean;
  created_at: string;
};

export type { ShopDeviceStatus };

export type DeviceUsageSummary = {
  activeCount: number;
  totalCount: number;
  planLimit: number | null;
  atPlanLimit: boolean;
};

/** Plan device cap from subscription_plans.features.devices only; null = unlimited. */
export function parsePlanDeviceLimit(snapshot: SubscriptionSnapshot, authMode: "supabase" | "local"): number | null {
  if (authMode === "local") return null;
  if (snapshot.kind !== "remote") return null;
  if (snapshot.row.max_devices != null && snapshot.row.max_devices > 0) {
    return snapshot.row.max_devices;
  }
  return null;
}

export function buildDeviceUsageSummary(
  devices: ShopDeviceRow[],
  planLimit: number | null,
): DeviceUsageSummary {
  const activeCount = devices.filter((d) => isActiveDeviceStatus(d.status)).length;
  const totalCount = devices.length;
  const atPlanLimit = planLimit != null && planLimit > 0 && activeCount >= planLimit;
  return { activeCount, totalCount, planLimit, atPlanLimit };
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
        status: normalizeShopDeviceStatus(
          r.status ?? (r.is_active === false ? "disconnected" : "active"),
        ),
        is_active: Boolean(r.is_active),
        created_at: String(r.created_at ?? ""),
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
