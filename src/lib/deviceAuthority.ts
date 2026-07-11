/**
 * Device authority layer — approval and operational status for cloud shops.
 * Every approved operational device is equal; there is no primary device gate.
 */

import { getOrCreateDeviceId } from "./deviceId";
import { resolveShopCtx } from "../offline/cloudSync";
import { supabase } from "./supabase";

export type DeviceFormFactor = "tablet" | "phone" | "windows" | "kitchen" | "bar";
export type DeviceApprovalStatus = "pending" | "approved" | "suspended" | "revoked" | "disabled";

/** Sensitive actions require an approved operational device on cloud shops. */
export type DeviceAuthorizedAction =
  | "staff_manage"
  | "device_approve"
  | "device_remove"
  | "cloud_recovery"
  | "backup_restore"
  | "backup_export"
  | "backup_import"
  | "subscription_manage"
  | "business_settings"
  | "security_settings"
  | "factory_reset";

export type DeviceAuthorityContext = {
  shopId: string;
  deviceFingerprint: string;
  deviceId: string | null;
  formFactor: DeviceFormFactor;
  approvalStatus: DeviceApprovalStatus;
  /** Approved and active — can perform owner management actions. */
  isDeviceAuthorized: boolean;
  isApproved: boolean;
  isOperational: boolean;
  status: string;
  lastSyncAt: string | null;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  currentStaffClientId: string | null;
  appVersion: string | null;
  label: string | null;
  platform: string | null;
  pendingUploads: number;
  pendingDownloads: number;
  cloudStatus: string | null;
  recoveryStatus: string | null;
};

const CACHE_KEY = "waka.device.authority.v2";
const CACHE_TTL_MS = 5 * 60_000;

type CachedEntry = { ctx: DeviceAuthorityContext; at: number };
let memoryCache: CachedEntry | null = null;

function readOfflineCache(shopId: string): DeviceAuthorityContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (parsed.ctx.shopId !== shopId) return null;
    return parsed.ctx;
  } catch {
    return null;
  }
}

function writeOfflineCache(ctx: DeviceAuthorityContext): void {
  if (typeof window === "undefined") {
    memoryCache = { ctx, at: Date.now() };
    return;
  }
  memoryCache = { ctx, at: Date.now() };
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(memoryCache));
}

/** Test helper — seed authority cache without cloud round-trip. */
export function seedDeviceAuthorityCacheForTests(ctx: DeviceAuthorityContext): void {
  writeOfflineCache(ctx);
}

export function clearDeviceAuthorityCache(): void {
  memoryCache = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(CACHE_KEY);
    window.localStorage.removeItem("waka.device.authority.v1");
  }
}

function parseContext(data: unknown, shopId: string, fp: string): DeviceAuthorityContext | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  const approval = String(r.approval_status ?? "approved") as DeviceApprovalStatus;
  const operational =
    r.is_device_authorized === true ||
    r.operational === true ||
    (approval === "approved" && String(r.status) === "active");
  const isApproved = approval === "approved";
  return {
    shopId,
    deviceFingerprint: fp,
    deviceId: r.device_id != null ? String(r.device_id) : null,
    formFactor: (String(r.form_factor ?? "tablet") as DeviceFormFactor) || "tablet",
    approvalStatus: approval,
    isDeviceAuthorized: operational && isApproved,
    isApproved,
    isOperational: operational,
    status: String(r.status ?? "unknown"),
    lastSyncAt: r.last_sync_at != null ? String(r.last_sync_at) : null,
    lastLoginAt: r.last_login_at != null ? String(r.last_login_at) : null,
    lastSeenAt: r.last_seen_at != null ? String(r.last_seen_at) : null,
    currentStaffClientId:
      r.current_staff_client_id != null ? String(r.current_staff_client_id) : null,
    appVersion: r.app_version != null ? String(r.app_version) : null,
    label: r.label != null ? String(r.label) : null,
    platform: r.platform != null ? String(r.platform) : null,
    pendingUploads: Number(r.pending_uploads ?? 0) || 0,
    pendingDownloads: Number(r.pending_downloads ?? 0) || 0,
    cloudStatus: r.cloud_status != null ? String(r.cloud_status) : null,
    recoveryStatus: r.recovery_status != null ? String(r.recovery_status) : null,
  };
}

export function isDeviceAuthorizedForManagement(ctx: DeviceAuthorityContext | null): boolean {
  if (!ctx) return true;
  return ctx.isDeviceAuthorized;
}

/** Fetch device authority from cloud; falls back to offline cache. */
export async function fetchDeviceAuthorityContext(
  shopId?: string,
): Promise<DeviceAuthorityContext | null> {
  const ctx = shopId ? { shopId } : await resolveShopCtx();
  if (!ctx) return null;
  const fp = getOrCreateDeviceId();

  if (memoryCache && memoryCache.ctx.shopId === ctx.shopId && Date.now() - memoryCache.at < CACHE_TTL_MS) {
    return memoryCache.ctx;
  }

  if (!supabase) {
    return readOfflineCache(ctx.shopId);
  }

  const { data, error } = await supabase.rpc("shop_device_context", {
    p_shop_id: ctx.shopId,
    p_device_fingerprint: fp,
  });
  if (error) {
    console.warn("[waka-device-authority]", error.message);
    const cached = readOfflineCache(ctx.shopId);
    if (cached) return cached;
    return null;
  }
  const parsed = parseContext(data, ctx.shopId, fp);
  if (parsed) writeOfflineCache(parsed);
  return parsed;
}

export function getCachedDeviceAuthoritySync(): DeviceAuthorityContext | null {
  if (memoryCache) return memoryCache.ctx;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    memoryCache = parsed;
    return parsed.ctx;
  } catch {
    return null;
  }
}

export function isDeviceAuthorizedForManagementSync(): boolean {
  return isDeviceAuthorizedForManagement(getCachedDeviceAuthoritySync());
}

export function isDeviceApprovedCachedSync(): boolean {
  const ctx = getCachedDeviceAuthoritySync();
  if (!ctx) return true;
  return ctx.isApproved && ctx.approvalStatus !== "pending";
}

export function canPerformDeviceAuthorizedActionSync(_action: DeviceAuthorizedAction): boolean {
  return isDeviceAuthorizedForManagementSync();
}

export async function canPerformDeviceAuthorizedAction(
  action: DeviceAuthorizedAction,
  shopId?: string,
): Promise<boolean> {
  void action;
  const ctx = await fetchDeviceAuthorityContext(shopId);
  return isDeviceAuthorizedForManagement(ctx);
}

export async function setDeviceApprovalStatus(
  shopId: string,
  deviceId: string,
  approvalStatus: DeviceApprovalStatus,
): Promise<{ ok: boolean; error?: string; limitBlocked?: boolean }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("shop_device_set_approval", {
    p_shop_id: shopId,
    p_device_id: deviceId,
    p_approval_status: approvalStatus,
    p_actor_device_fingerprint: getOrCreateDeviceId(),
  });
  if (error) return { ok: false, error: error.message };
  clearDeviceAuthorityCache();
  const payload = data as { ok?: boolean; error?: string; limit_blocked?: boolean } | null;
  return {
    ok: payload?.ok === true,
    error: payload?.error,
    limitBlocked: payload?.limit_blocked === true,
  };
}
