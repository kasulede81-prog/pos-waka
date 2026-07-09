/**
 * Phase 13.2 — enterprise session manager (activity, expiry, persistence).
 */

import type { ShopPreferences, UserRole } from "../../types";
import {
  clearStaffSession,
  readStaffSession,
  writeStaffSession,
  type PersistedStaffSession,
} from "../staffOfflineAuth";
import { logStaffSessionAudit } from "./staffSessionAudit";

export const STAFF_AUTO_LOCK_OPTIONS = [0, 2, 5, 10, 15, 30, 60] as const;
export type StaffAutoLockMinutes = (typeof STAFF_AUTO_LOCK_OPTIONS)[number];

export const DEFAULT_STAFF_SESSION_TIMEOUT_MINUTES = 480;
export const DEFAULT_STAFF_MAX_FAILED_ATTEMPTS = 5;

const ACTIVITY_KEY = "waka.staff.session.activity.v1";
const SESSION_STARTED_KEY = "waka.staff.session.started.v1";

export type StaffSessionRuntime = {
  unlocked: boolean;
  lastActivityAt: string;
  sessionStartedAt: string;
  expiresAt: string | null;
};

function readIso(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writeIso(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function resolveStaffSessionTimeoutMinutes(preferences: ShopPreferences): number {
  const raw = preferences.staffSessionTimeoutMinutes;
  if (typeof raw !== "number" || Number.isNaN(raw) || raw <= 0) return DEFAULT_STAFF_SESSION_TIMEOUT_MINUTES;
  return Math.min(Math.max(Math.floor(raw), 15), 24 * 60);
}

export function resolveStaffAutoLockMinutes(preferences: ShopPreferences): StaffAutoLockMinutes {
  const raw = preferences.staffAutoLockMinutes;
  if (typeof raw !== "number") return 0;
  return (STAFF_AUTO_LOCK_OPTIONS as readonly number[]).includes(raw)
    ? (raw as StaffAutoLockMinutes)
    : 0;
}

export function resolveStaffMaxFailedAttempts(preferences: ShopPreferences): number {
  const raw = preferences.staffMaxFailedAttempts;
  if (typeof raw !== "number" || Number.isNaN(raw)) return DEFAULT_STAFF_MAX_FAILED_ATTEMPTS;
  return Math.min(Math.max(Math.floor(raw), 3), 10);
}

export function staffRememberSessionEnabled(preferences: ShopPreferences): boolean {
  return preferences.staffRememberSession !== false;
}

export function staffAllowSwitchUser(preferences: ShopPreferences): boolean {
  return preferences.staffAllowSwitchUser !== false;
}

export function staffRequirePinAfterIdle(preferences: ShopPreferences): boolean {
  return preferences.staffRequirePinAfterIdle !== false;
}

export function touchStaffActivity(at = new Date().toISOString()): void {
  writeIso(ACTIVITY_KEY, at);
}

export function readStaffLastActivity(): string | null {
  return readIso(ACTIVITY_KEY);
}

export function startStaffSessionClock(at = new Date().toISOString()): void {
  writeIso(SESSION_STARTED_KEY, at);
  touchStaffActivity(at);
}

export function readStaffSessionStartedAt(): string | null {
  return readIso(SESSION_STARTED_KEY);
}

export function computeSessionExpiresAt(preferences: ShopPreferences, startedAt: string): string {
  const minutes = resolveStaffSessionTimeoutMinutes(preferences);
  return new Date(Date.parse(startedAt) + minutes * 60 * 1000).toISOString();
}

export function isStaffSessionExpired(preferences: ShopPreferences, now = Date.now()): boolean {
  if (!staffRememberSessionEnabled(preferences)) return true;
  const startedAt = readStaffSessionStartedAt();
  if (!startedAt) return false;
  const expiresAt = computeSessionExpiresAt(preferences, startedAt);
  return Date.parse(expiresAt) <= now;
}

export function getStaffSessionRuntime(preferences: ShopPreferences): StaffSessionRuntime {
  const startedAt = readStaffSessionStartedAt() ?? new Date().toISOString();
  const lastActivityAt = readStaffLastActivity() ?? startedAt;
  const expiresAt = staffRememberSessionEnabled(preferences) ? computeSessionExpiresAt(preferences, startedAt) : null;
  return {
    unlocked: !preferences.posLocked,
    lastActivityAt,
    sessionStartedAt: startedAt,
    expiresAt,
  };
}

export function persistStaffSessionRow(row: PersistedStaffSession): void {
  writeStaffSession(row);
  startStaffSessionClock();
}

export function readPersistedStaffSession(): PersistedStaffSession | null {
  return readStaffSession();
}

export function clearStaffSessionPersistence(): void {
  clearStaffSession();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ACTIVITY_KEY);
    window.localStorage.removeItem(SESSION_STARTED_KEY);
  }
}

export function handleStaffSessionExpired(opts: {
  preferences: ShopPreferences;
  staffId?: string | null;
  staffName?: string | null;
}): void {
  logStaffSessionAudit("staff_session_expired", {
    staffId: opts.staffId ?? opts.preferences.activeStaffId ?? null,
    staffName: opts.staffName ?? null,
  });
}

export type RestoredStaffSession = {
  accountKey: string;
  businessName: string;
  staffId: string;
  staffName: string;
  role: UserRole;
};

export function tryRestorePersistedStaffSession(): RestoredStaffSession | null {
  const row = readStaffSession();
  if (!row) return null;
  return {
    accountKey: row.accountKey,
    businessName: row.businessName,
    staffId: row.staffId,
    staffName: row.staffName,
    role: row.role,
  };
}
