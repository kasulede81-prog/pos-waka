/**
 * Device Authority layer — Phase 2.
 * Authority (primary/secondary) is separate from form factor (tablet/phone/windows/kitchen/bar).
 * Cloud authoritative; offline cache in localStorage.
 */

import { getOrCreateDeviceId } from "./deviceId";
import { resolveShopCtx } from "../offline/cloudSync";
import { supabase } from "./supabase";
import { ENFORCE_PRIMARY_DEVICE } from "./deviceAuthorityPolicy";

export type DeviceAuthority = "primary" | "secondary";
export type DeviceFormFactor = "tablet" | "phone" | "windows" | "kitchen" | "bar";
export type DeviceApprovalStatus = "pending" | "approved" | "suspended" | "revoked" | "disabled";

/** Primary-only actions enforced on client + server. */
export type PrimaryOnlyAction =
  | "staff_manage"
  | "device_approve"
  | "device_remove"
  | "primary_transfer"
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
  deviceAuthority: DeviceAuthority;
  formFactor: DeviceFormFactor;
  approvalStatus: DeviceApprovalStatus;
  isPrimary: boolean;
  isApproved: boolean;
  isOperational: boolean;
  primaryDeviceFingerprint: string | null;
  primaryDeviceId: string | null;
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

const CACHE_KEY = "waka.device.authority.v1";
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
  if (typeof window !== "undefined") window.localStorage.removeItem(CACHE_KEY);
}

function parseContext(data: unknown, shopId: string, fp: string): DeviceAuthorityContext | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  const authority = String(r.device_authority ?? (r.is_primary ? "primary" : "secondary")) as DeviceAuthority;
  const approval = String(r.approval_status ?? "approved") as DeviceApprovalStatus;
  const operational = r.operational === true || (approval === "approved" && String(r.status) === "active");
  return {
    shopId,
    deviceFingerprint: fp,
    deviceId: r.device_id != null ? String(r.device_id) : null,
    deviceAuthority: authority === "primary" ? "primary" : "secondary",
    formFactor: (String(r.form_factor ?? "tablet") as DeviceFormFactor) || "tablet",
    approvalStatus: approval,
    isPrimary: authority === "primary" || r.is_primary === true,
    isApproved: approval === "approved",
    isOperational: operational,
    primaryDeviceFingerprint:
      r.primary_device_fingerprint != null ? String(r.primary_device_fingerprint) : null,
    primaryDeviceId: r.primary_device_id != null ? String(r.primary_device_id) : null,
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

export function isPrimaryDeviceCachedSync(): boolean {
  if (!ENFORCE_PRIMARY_DEVICE) return true;
  const ctx = getCachedDeviceAuthoritySync();
  if (!ctx) return true;
  if (!ctx.primaryDeviceFingerprint) return true;
  return ctx.isPrimary;
}

export function isDeviceApprovedCachedSync(): boolean {
  const ctx = getCachedDeviceAuthoritySync();
  if (!ctx) return true;
  return ctx.isApproved && ctx.approvalStatus !== "pending";
}

export function canPerformPrimaryActionSync(_action: PrimaryOnlyAction): boolean {
  return isPrimaryDeviceCachedSync();
}

export async function canPerformPrimaryAction(
  action: PrimaryOnlyAction,
  shopId?: string,
): Promise<boolean> {
  void action;
  if (!ENFORCE_PRIMARY_DEVICE) {
    const ctx = await fetchDeviceAuthorityContext(shopId);
    if (!ctx) return true;
    return ctx.isApproved && ctx.approvalStatus !== "pending";
  }
  const ctx = await fetchDeviceAuthorityContext(shopId);
  if (!ctx) return true;
  if (!ctx.primaryDeviceFingerprint) return true;
  return ctx.isPrimary && ctx.isApproved;
}

export async function transferPrimaryDevice(
  shopId: string,
  newDeviceFingerprint: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const actorFp = getOrCreateDeviceId();
  const { data, error } = await supabase.rpc("shop_device_transfer_primary", {
    p_shop_id: shopId,
    p_new_device_fingerprint: newDeviceFingerprint,
    p_actor_device_fingerprint: actorFp,
  });
  if (error) return { ok: false, error: error.message };
  clearDeviceAuthorityCache();
  return { ok: (data as { ok?: boolean })?.ok === true, error: (data as { error?: string })?.error };
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

export async function setCurrentDeviceAsPrimary(shopId: string): Promise<{ ok: boolean; error?: string }> {
  return transferPrimaryDevice(shopId, getOrCreateDeviceId());
}

// Legacy alias
export type PrimaryDeviceContext = DeviceAuthorityContext;
