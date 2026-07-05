import { Capacitor } from "@capacitor/core";
import { appendDeviceAuditEntry } from "./deviceAudit";
import { getOrCreateDeviceId } from "./deviceId";
import {
  notifyOwnerNewDeviceActivation,
  reportDeviceFingerprintChangeIfNeeded,
} from "./deviceFingerprintTrust";
import { supabase } from "./supabase";

function presencePlatform(): string {
  if (typeof window === "undefined") return "server";
  if (Capacitor.isNativePlatform()) return Capacitor.getPlatform();
  return "web";
}

function presenceLabel(): string {
  const platform = presencePlatform();
  if (platform === "android") return "Android POS";
  if (platform === "ios") return "iOS POS";
  return "Web POS";
}

export type DeviceLimitContextDevice = {
  id: string;
  device_fingerprint: string;
  label: string | null;
  platform: string | null;
  last_seen_at: string | null;
  status: string;
};

export type DeviceLimitContext = {
  shop_id: string;
  plan_code: string;
  plan_name: string;
  device_limit: number | null;
  active_count: number;
  is_owner: boolean;
  at_limit: boolean;
  devices: DeviceLimitContextDevice[];
};

export type DeviceActivationResult = {
  ok: boolean;
  activated: boolean;
  accepted?: boolean;
  limit_blocked?: boolean;
  pending_approval?: boolean;
  approval_status?: string;
  device_authority?: string;
  revoked?: boolean;
  existing_device?: boolean;
  reactivated?: boolean;
  status?: string;
  plan_code?: string;
  plan_name?: string;
  active_count?: number;
  device_limit?: number | null;
};

function parseActivationResult(data: unknown): DeviceActivationResult {
  if (!data || typeof data !== "object") return { ok: false, activated: false };
  const r = data as Record<string, unknown>;
  const activated = r.activated === true && r.limit_blocked !== true;
  return {
    ok: r.ok === true,
    activated,
    accepted: r.accepted === true,
    limit_blocked: r.limit_blocked === true,
    pending_approval: r.pending_approval === true,
    approval_status: r.approval_status != null ? String(r.approval_status) : undefined,
    device_authority: r.device_authority != null ? String(r.device_authority) : undefined,
    revoked: r.revoked === true,
    existing_device: r.existing_device === true,
    reactivated: r.reactivated === true,
    status: r.status != null ? String(r.status) : undefined,
    plan_code: r.plan_code != null ? String(r.plan_code) : undefined,
    plan_name: r.plan_name != null ? String(r.plan_name) : undefined,
    active_count: typeof r.active_count === "number" ? r.active_count : undefined,
    device_limit:
      typeof r.device_limit === "number"
        ? r.device_limit
        : r.device_limit === null
          ? null
          : undefined,
  };
}

function presenceFields(shopId: string) {
  return {
    p_shop_id: shopId,
    p_device_fingerprint: getOrCreateDeviceId(),
    p_label: presenceLabel(),
    p_platform: presencePlatform(),
    p_app_version: import.meta.env.VITE_APP_VERSION ?? "1.0.0",
  };
}

function applyActivationSideEffects(shopId: string, parsed: DeviceActivationResult): void {
  void reportDeviceFingerprintChangeIfNeeded(shopId);
  if (parsed.reactivated) {
    appendDeviceAuditEntry("device_reactivated", "Device reactivated after login", {
      shopId,
      deviceFingerprint: getOrCreateDeviceId(),
    });
  }
  if (parsed.ok && parsed.activated && !parsed.existing_device && !parsed.reactivated) {
    void notifyOwnerNewDeviceActivation(shopId, getOrCreateDeviceId());
    appendDeviceAuditEntry("device_new_activation", "New device activated on this shop", {
      shopId,
      deviceFingerprint: getOrCreateDeviceId(),
    });
  }
  if (parsed.limit_blocked) {
    appendDeviceAuditEntry("device_login_blocked", "Device activation blocked at plan limit", {
      shopId,
      deviceFingerprint: getOrCreateDeviceId(),
      planCode: parsed.plan_code,
      activeCount: parsed.active_count,
      deviceLimit: parsed.device_limit,
    });
  }
  if (parsed.ok && parsed.activated && !parsed.pending_approval && parsed.approval_status !== "pending") {
    void import("./staffCacheSync").then(({ scheduleStaffCacheProvisioning }) => {
      scheduleStaffCacheProvisioning();
    });
  }
}

export async function ensureShopDeviceActivation(shopId: string): Promise<DeviceActivationResult> {
  if (!shopId || !supabase) return { ok: true, activated: true };
  const args = presenceFields(shopId);
  const { data, error } = await supabase.rpc("shop_device_ensure_activation", args);
  if (error) throw error;
  const parsed = parseActivationResult(data);
  applyActivationSideEffects(shopId, parsed);
  return parsed;
}

export async function registerShopDeviceOnLogin(shopId: string): Promise<DeviceActivationResult> {
  if (!shopId || !supabase) return { ok: true, activated: true };
  const args = presenceFields(shopId);
  const { data, error } = await supabase.rpc("shop_device_register_on_login", args);
  if (error) throw error;
  const parsed = parseActivationResult(data);
  applyActivationSideEffects(shopId, parsed);
  const { fetchDeviceAuthorityContext } = await import("./deviceAuthority");
  await fetchDeviceAuthorityContext(shopId);
  return parsed;
}

export async function fetchShopDeviceLimitContext(shopId: string): Promise<DeviceLimitContext | null> {
  if (!shopId || !supabase) return null;
  const { data, error } = await supabase.rpc("shop_device_limit_context", { p_shop_id: shopId });
  if (error) throw error;
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  const devicesRaw = r.devices;
  const devices = Array.isArray(devicesRaw)
    ? devicesRaw.map((row) => {
        const d = row as Record<string, unknown>;
        return {
          id: String(d.id ?? ""),
          device_fingerprint: String(d.device_fingerprint ?? ""),
          label: d.label != null ? String(d.label) : null,
          platform: d.platform != null ? String(d.platform) : null,
          last_seen_at: d.last_seen_at != null ? String(d.last_seen_at) : null,
          status: String(d.status ?? "active"),
        };
      })
    : [];
  const limitRaw = r.device_limit;
  return {
    shop_id: String(r.shop_id ?? shopId),
    plan_code: String(r.plan_code ?? ""),
    plan_name: String(r.plan_name ?? ""),
    device_limit: typeof limitRaw === "number" && limitRaw > 0 ? limitRaw : null,
    active_count: typeof r.active_count === "number" ? r.active_count : 0,
    is_owner: Boolean(r.is_owner),
    at_limit: Boolean(r.at_limit),
    devices,
  };
}

export async function recordDeviceReplacementCompleted(
  shopId: string,
  oldDeviceFingerprint: string,
): Promise<void> {
  const newFp = getOrCreateDeviceId();
  appendDeviceAuditEntry("device_replacement_completed", "Owner freed a device slot for this device", {
    shopId,
    oldDeviceFingerprint,
    newDeviceFingerprint: newFp,
  });
  if (!supabase) return;
  await supabase.rpc("owner_record_device_replacement", {
    p_shop_id: shopId,
    p_old_device_fingerprint: oldDeviceFingerprint,
    p_new_device_fingerprint: newFp,
  });
}
