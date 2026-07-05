/**
 * Phase 4 — staff login security: lockout, device trust, offline persistence, audit.
 */

import type { StaffAccount } from "../types";
import { getDeviceOnline } from "./deviceOnline";
import { getOrCreateDeviceId } from "./deviceId";
import { presencePlatform } from "./shopPresence";
import { isStaffLoginLocked } from "./staffSecret";
import { logStaffSecurityAudit } from "./staffSecurityAudit";
import {
  readOfflineStaffCache,
  writeOfflineStaffCache,
  type OfflineStaffCacheRecord,
} from "./offlineStaffCache";

export const STAFF_LOCKOUT_MAX_ATTEMPTS = 5;
export const STAFF_LOCKOUT_MINUTES = 15;
export const STAFF_SECURITY_WINDOW_HOURS = 24;
export const STAFF_SECURITY_WINDOW_MAX = 10;

export type StaffLoginAttemptResult = {
  ok: boolean;
  success?: boolean;
  lockedUntil?: string | null;
  attempts?: number;
  failuresInWindow?: number;
  error?: string;
  deviceChanged?: boolean;
  previousDeviceFingerprint?: string | null;
};

const PENDING_SECURITY_KEY = "waka.staff.security.pending.v1";

type PendingSecurityEvent = {
  shopId: string;
  staffClientId: string;
  eventType: string;
  deviceFingerprint: string;
  platform: string;
  online: boolean;
  reason: string;
  payload: Record<string, unknown>;
  at: string;
};

function readPendingSecurityEvents(): PendingSecurityEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_SECURITY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingSecurityEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingSecurityEvents(events: PendingSecurityEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_SECURITY_KEY, JSON.stringify(events));
  } catch {
    /* ignore */
  }
}

export function queuePendingStaffSecurityEvent(event: Omit<PendingSecurityEvent, "at">): void {
  const events = readPendingSecurityEvents();
  events.push({ ...event, at: new Date().toISOString() });
  writePendingSecurityEvents(events);
}

export async function flushPendingStaffSecurityEvents(): Promise<void> {
  if (!getDeviceOnline()) return;
  const events = readPendingSecurityEvents();
  if (events.length === 0) return;
  const { supabase } = await import("./supabase");
  if (!supabase) return;

  const remaining: PendingSecurityEvent[] = [];
  for (const event of events) {
    const { error } = await supabase.rpc("shop_pos_staff_record_security_event", {
      p_shop_id: event.shopId,
      p_client_id: event.staffClientId,
      p_event_type: event.eventType,
      p_device_fingerprint: event.deviceFingerprint,
      p_platform: event.platform,
      p_online: event.online,
      p_reason: event.reason,
      p_payload: event.payload,
    });
    if (error) remaining.push(event);
  }
  writePendingSecurityEvents(remaining);
}

function windowExpired(staff: StaffAccount, now: Date): boolean {
  if (!staff.failureWindowStartedAt) return true;
  return now.getTime() - Date.parse(staff.failureWindowStartedAt) > STAFF_SECURITY_WINDOW_HOURS * 60 * 60 * 1000;
}

export function applyLocalFailedLogin(staff: StaffAccount): StaffAccount {
  const now = new Date();
  const attempts = (staff.failedPinAttempts ?? 0) + 1;
  let failuresInWindow = staff.failuresInWindow ?? 0;
  let failureWindowStartedAt = staff.failureWindowStartedAt ?? null;

  if (windowExpired(staff, now)) {
    failuresInWindow = 1;
    failureWindowStartedAt = now.toISOString();
  } else {
    failuresInWindow += 1;
  }

  const lockedUntil =
    attempts >= STAFF_LOCKOUT_MAX_ATTEMPTS
      ? new Date(now.getTime() + STAFF_LOCKOUT_MINUTES * 60 * 1000).toISOString()
      : staff.lockedUntil ?? null;

  return {
    ...staff,
    failedPinAttempts: attempts,
    lastFailedLoginAt: now.toISOString(),
    firstFailedLoginAt: staff.firstFailedLoginAt ?? now.toISOString(),
    failuresInWindow,
    failureWindowStartedAt,
    lockedUntil,
    updatedAt: now.toISOString(),
  };
}

export function applyLocalSuccessfulLogin(
  staff: StaffAccount,
  deviceFingerprint: string,
  platform: string,
): { staff: StaffAccount; deviceChanged: boolean; previousDeviceFingerprint: string | null } {
  const now = new Date().toISOString();
  const previousDeviceFingerprint = staff.lastDeviceFingerprint ?? null;
  const deviceChanged = Boolean(
    previousDeviceFingerprint && previousDeviceFingerprint !== deviceFingerprint,
  );
  return {
    staff: {
      ...staff,
      lastLoginAt: now,
      lastDeviceFingerprint: deviceFingerprint,
      lastLoginPlatform: platform,
      failedPinAttempts: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
      firstFailedLoginAt: null,
      failuresInWindow: 0,
      failureWindowStartedAt: null,
      updatedAt: now,
    },
    deviceChanged,
    previousDeviceFingerprint,
  };
}

export async function assertStaffLoginDeviceApproved(shopId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { fetchDeviceAuthorityContext } = await import("./deviceAuthority");
  const ctx = await fetchDeviceAuthorityContext(shopId);
  if (!ctx) return { ok: true };
  if (ctx.isApproved && ctx.isOperational) return { ok: true };
  if (ctx.approvalStatus === "pending") {
    return { ok: false, error: "This device is pending approval. Ask the owner to approve it on the Primary Device." };
  }
  if (!ctx.isApproved || ctx.approvalStatus === "revoked" || ctx.approvalStatus === "suspended") {
    return { ok: false, error: "This device is not approved for staff login." };
  }
  return { ok: true };
}

async function persistStaffToCache(
  accountKey: string,
  shopId: string,
  staffId: string,
  patch: Partial<StaffAccount>,
): Promise<void> {
  const cache = await readOfflineStaffCache(shopId, accountKey);
  if (!cache) return;
  const staff = cache.staff.map((row) => (row.id === staffId ? { ...row, ...patch } : row));
  const next: OfflineStaffCacheRecord = { ...cache, staff, downloadedAt: new Date().toISOString() };
  await writeOfflineStaffCache(next, accountKey);
}

export async function recordStaffLoginAttemptLocal(opts: {
  accountKey: string;
  shopId: string;
  staff: StaffAccount;
  success: boolean;
  online: boolean;
}): Promise<StaffLoginAttemptResult> {
  const deviceFingerprint = getOrCreateDeviceId();
  const platform = presencePlatform();

  if (opts.online && getDeviceOnline()) {
    const { recordStaffLoginAttempt } = await import("./shopStaffCloud");
    const cloud = await recordStaffLoginAttempt(opts.shopId, opts.staff.id, opts.success, {
      platform,
      online: true,
    });
    if (cloud.ok) {
      await persistStaffToCache(opts.accountKey, opts.shopId, opts.staff.id, {
        failedPinAttempts: cloud.attempts ?? 0,
        lockedUntil: cloud.lockedUntil ?? null,
        lastLoginAt: opts.success ? new Date().toISOString() : opts.staff.lastLoginAt,
        lastDeviceFingerprint: opts.success ? deviceFingerprint : opts.staff.lastDeviceFingerprint,
        lastLoginPlatform: opts.success ? platform : opts.staff.lastLoginPlatform,
      });
      if (opts.success) {
        logStaffSecurityAudit("staff_login", {
          staffId: opts.staff.id,
          staffName: opts.staff.name,
          online: true,
          platform,
          deviceFingerprint,
        });
      } else if (cloud.lockedUntil) {
        logStaffSecurityAudit("staff_lockout_triggered", {
          staffId: opts.staff.id,
          staffName: opts.staff.name,
          attempts: cloud.attempts,
          lockedUntil: cloud.lockedUntil,
          online: true,
        });
      } else {
        logStaffSecurityAudit("staff_login_failed", {
          staffId: opts.staff.id,
          staffName: opts.staff.name,
          attempts: cloud.attempts,
          online: true,
        });
      }
      return {
        ok: true,
        success: opts.success,
        lockedUntil: cloud.lockedUntil,
        attempts: cloud.attempts,
        failuresInWindow: cloud.failuresInWindow,
        deviceChanged: cloud.deviceChanged,
        previousDeviceFingerprint: cloud.previousDeviceFingerprint,
      };
    }
  }

  if (opts.success) {
    const { staff: next, deviceChanged, previousDeviceFingerprint } = applyLocalSuccessfulLogin(
      opts.staff,
      deviceFingerprint,
      platform,
    );
    await persistStaffToCache(opts.accountKey, opts.shopId, opts.staff.id, next);
    logStaffSecurityAudit("staff_login", {
      staffId: opts.staff.id,
      staffName: opts.staff.name,
      online: false,
      platform,
      deviceFingerprint,
    });
    if (deviceChanged) {
      logStaffSecurityAudit("staff_device_changed", {
        staffId: opts.staff.id,
        staffName: opts.staff.name,
        previousDeviceFingerprint,
        newDeviceFingerprint: deviceFingerprint,
        online: false,
      });
      queuePendingStaffSecurityEvent({
        shopId: opts.shopId,
        staffClientId: opts.staff.id,
        eventType: "staff_device_changed",
        deviceFingerprint,
        platform,
        online: false,
        reason: "Staff logged in from a different device (offline)",
        payload: { previousDeviceFingerprint, newDeviceFingerprint: deviceFingerprint },
      });
    }
    queuePendingStaffSecurityEvent({
      shopId: opts.shopId,
      staffClientId: opts.staff.id,
      eventType: "staff_login_success",
      deviceFingerprint,
      platform,
      online: false,
      reason: "Staff login successful (offline)",
      payload: {},
    });
    return { ok: true, success: true, deviceChanged, previousDeviceFingerprint };
  }

  const next = applyLocalFailedLogin(opts.staff);
  await persistStaffToCache(opts.accountKey, opts.shopId, opts.staff.id, next);
  const locked = isStaffLoginLocked(next);
  logStaffSecurityAudit(locked ? "staff_lockout_triggered" : "staff_login_failed", {
    staffId: opts.staff.id,
    staffName: opts.staff.name,
    attempts: next.failedPinAttempts,
    lockedUntil: next.lockedUntil,
    online: false,
  });
  queuePendingStaffSecurityEvent({
    shopId: opts.shopId,
    staffClientId: opts.staff.id,
    eventType: locked ? "staff_lockout_triggered" : "staff_login_failed",
    deviceFingerprint,
    platform,
    online: false,
    reason: locked ? "Account locked after failed attempts (offline)" : "Staff login failed (offline)",
    payload: {
      attempts: next.failedPinAttempts,
      failuresInWindow: next.failuresInWindow,
    },
  });
  if ((next.failuresInWindow ?? 0) >= STAFF_SECURITY_WINDOW_MAX) {
    queuePendingStaffSecurityEvent({
      shopId: opts.shopId,
      staffClientId: opts.staff.id,
      eventType: "staff_security_alert",
      deviceFingerprint,
      platform,
      online: false,
      reason: "10 failed login attempts within 24 hours (offline)",
      payload: { failuresInWindow: next.failuresInWindow },
    });
  }
  return {
    ok: true,
    success: false,
    lockedUntil: next.lockedUntil,
    attempts: next.failedPinAttempts,
    failuresInWindow: next.failuresInWindow,
  };
}

export async function unlockStaffAccountLocal(opts: {
  accountKey: string;
  shopId: string;
  staffId: string;
  staffName: string;
}): Promise<boolean> {
  const patch: Partial<StaffAccount> = {
    failedPinAttempts: 0,
    lockedUntil: null,
    lastFailedLoginAt: null,
    firstFailedLoginAt: null,
    failuresInWindow: 0,
    failureWindowStartedAt: null,
    updatedAt: new Date().toISOString(),
  };
  await persistStaffToCache(opts.accountKey, opts.shopId, opts.staffId, patch);
  logStaffSecurityAudit("staff_account_unlocked", {
    staffId: opts.staffId,
    staffName: opts.staffName,
    online: getDeviceOnline(),
  });
  return true;
}
