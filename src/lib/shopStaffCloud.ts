import type { Permission, StaffAccount, UserRole } from "../types";
import { isSupabaseEmailVerified } from "./emailVerification";
import { resolveShopCtx } from "../offline/cloudSync";
import { getOrCreateDeviceId } from "./deviceId";
import { supabase } from "./supabase";
import type { User } from "@supabase/supabase-js";

export type CloudStaffRow = {
  id: string;
  client_id: string | null;
  name: string;
  username: string | null;
  role: UserRole;
  pin_hash: string | null;
  password_hash: string | null;
  phone_e164: string | null;
  email: string | null;
  permissions: Permission[];
  is_active: boolean;
  last_login_at: string | null;
  last_device_fingerprint: string | null;
  last_login_platform: string | null;
  failed_pin_attempts: number | null;
  locked_until: string | null;
  last_failed_login_at: string | null;
  first_failed_login_at: string | null;
  failures_in_window: number | null;
  failure_window_started_at: string | null;
  pin_changed_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
};

function staffToCloudJson(staff: StaffAccount): Record<string, unknown> {
  return {
    id: staff.id.includes("-") ? staff.id : undefined,
    client_id: staff.id,
    name: staff.name,
    username: staff.username ?? null,
    role: staff.role,
    pin_hash: staff.pinHash ?? null,
    password_hash: staff.passwordHash ?? null,
    phone_e164: staff.phone ?? null,
    email: staff.email ?? null,
    permissions: staff.permissions ?? [],
    is_active: staff.active,
  };
}

function cloudRowToStaff(row: CloudStaffRow): StaffAccount {
  return {
    id: row.client_id ?? row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    permissions: row.permissions,
    pin: null,
    password: null,
    pinHash: row.pin_hash,
    passwordHash: row.password_hash,
    phone: row.phone_e164,
    email: row.email,
    active: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pendingCloudSync: false,
    lastLoginAt: row.last_login_at,
    lastDeviceFingerprint: row.last_device_fingerprint,
    lastLoginPlatform: row.last_login_platform,
    failedPinAttempts: row.failed_pin_attempts ?? 0,
    lockedUntil: row.locked_until,
    lastFailedLoginAt: row.last_failed_login_at,
    firstFailedLoginAt: row.first_failed_login_at,
    failuresInWindow: row.failures_in_window ?? 0,
    failureWindowStartedAt: row.failure_window_started_at,
    pinChangedAt: row.pin_changed_at,
    passwordChangedAt: row.password_changed_at,
  };
}

function deviceFingerprintArg(): string {
  return getOrCreateDeviceId();
}

export async function pullShopStaffFromCloud(): Promise<StaffAccount[] | null> {
  if (!supabase) return null;
  const ctx = await resolveShopCtx();
  if (!ctx) return null;
  const { data, error } = await supabase.rpc("shop_pos_staff_list", { p_shop_id: ctx.shopId });
  if (error) {
    console.warn("[waka-staff] pull", error.message);
    return null;
  }
  const rows = (Array.isArray(data) ? data : []) as CloudStaffRow[];
  return rows.map(cloudRowToStaff);
}

export async function pushStaffToCloud(staff: StaffAccount): Promise<boolean> {
  if (!supabase) return false;
  const ctx = await resolveShopCtx();
  if (!ctx) return false;
  const { data, error } = await supabase.rpc("shop_pos_staff_upsert", {
    p_shop_id: ctx.shopId,
    p_row: staffToCloudJson(staff),
    p_device_fingerprint: deviceFingerprintArg(),
  });
  if (error) {
    console.warn("[waka-staff] upsert", error.message);
    return false;
  }
  const result = data as { ok?: boolean; error?: string };
  if (result?.error === "device_not_authorized") {
    console.warn("[waka-staff] upsert blocked — device not authorized");
  }
  return result?.ok === true;
}

export async function setCloudStaffActive(shopId: string, staffId: string, active: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_pos_staff_set_active", {
    p_shop_id: shopId,
    p_staff_id: staffId,
    p_active: active,
    p_device_fingerprint: deviceFingerprintArg(),
  });
  if (error) return false;
  return (data as { ok?: boolean })?.ok === true;
}

export async function deleteCloudStaff(shopId: string, cloudStaffId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_pos_staff_delete", {
    p_shop_id: shopId,
    p_staff_id: cloudStaffId,
    p_device_fingerprint: deviceFingerprintArg(),
  });
  if (error) return false;
  return (data as { ok?: boolean })?.ok === true;
}

export async function importLocalStaffToCloud(shopId: string, staff: StaffAccount[]): Promise<number> {
  if (!supabase || staff.length === 0) return 0;
  const rows = staff.map(staffToCloudJson);
  const { data, error } = await supabase.rpc("shop_pos_staff_import_local", {
    p_shop_id: shopId,
    p_rows: rows,
  });
  if (error) {
    console.warn("[waka-staff] import", error.message);
    return 0;
  }
  return Number((data as { imported?: number })?.imported ?? 0);
}

export async function recordStaffLoginAttempt(
  shopId: string,
  clientId: string,
  success: boolean,
  opts?: { platform?: string; online?: boolean },
): Promise<{
  ok: boolean;
  lockedUntil?: string | null;
  attempts?: number;
  failuresInWindow?: number;
  deviceChanged?: boolean;
  previousDeviceFingerprint?: string | null;
  error?: string;
}> {
  if (!supabase) return { ok: false };
  const { presencePlatform } = await import("./shopPresence");
  const { data, error } = await supabase.rpc("shop_pos_staff_record_login", {
    p_shop_id: shopId,
    p_client_id: clientId,
    p_device_fingerprint: deviceFingerprintArg(),
    p_success: success,
    p_platform: opts?.platform ?? presencePlatform(),
    p_online: opts?.online ?? true,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as {
    ok?: boolean;
    locked_until?: string | null;
    attempts?: number;
    failures_in_window?: number;
    error?: string;
    previous_device_fingerprint?: string | null;
    device_changed?: boolean;
  };
  return {
    ok: r?.ok === true,
    lockedUntil: r?.locked_until ?? null,
    attempts: r?.attempts,
    failuresInWindow: r?.failures_in_window,
    error: r?.error,
    deviceChanged: r?.device_changed,
    previousDeviceFingerprint: r?.previous_device_fingerprint ?? null,
  };
}

export async function unlockCloudStaffAccount(shopId: string, clientId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_pos_staff_unlock", {
    p_shop_id: shopId,
    p_client_id: clientId,
    p_device_fingerprint: deviceFingerprintArg(),
  });
  if (error) return false;
  return (data as { ok?: boolean })?.ok === true;
}

export async function notifyStaffDeviceChange(
  shopId: string,
  staffClientId: string,
  previousFingerprint: string,
  newFingerprint: string,
): Promise<void> {
  if (!supabase) return;
  await supabase.rpc("shop_pos_staff_record_security_event", {
    p_shop_id: shopId,
    p_client_id: staffClientId,
    p_event_type: "staff_device_changed",
    p_device_fingerprint: newFingerprint,
    p_platform: (await import("./shopPresence")).presencePlatform(),
    p_online: true,
    p_reason: "Staff logged in from a different device",
    p_payload: {
      previous_device_fingerprint: previousFingerprint,
      new_device_fingerprint: newFingerprint,
      notify_primary: true,
    },
  });
}

/** Merge cloud staff into local preferences when verified and online. */
export async function syncStaffAccountsWithCloud(
  user: User | null,
  localStaff: StaffAccount[],
): Promise<StaffAccount[] | null> {
  if (!user || !isSupabaseEmailVerified(user)) return null;
  const { mergeStaffAccountsForCloudSync } = await import("./staffRecovery");
  let pulled = await pullShopStaffFromCloud();
  if (!pulled) return null;
  if (pulled.length === 0 && localStaff.length > 0) {
    const ctx = await resolveShopCtx();
    if (ctx) await importLocalStaffToCloud(ctx.shopId, localStaff);
    pulled = await pullShopStaffFromCloud();
    if (!pulled) return null;
  }
  if (pulled.length === 0 && localStaff.length === 0) return null;
  return mergeStaffAccountsForCloudSync(localStaff, pulled);
}
