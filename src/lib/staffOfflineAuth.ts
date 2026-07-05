import type { ShopPreferences, StaffAccount, UserRole } from "../types";
import { getLocalDb } from "../offline/localDb";
import { normalizeUserRole } from "./permissions";
import { isStaffLoginLocked, migrateStaffSecretsAfterLogin, normalizePin, staffSecretMatchesAsync } from "./staffSecret";
import type { StaffLoginRole } from "./staffLoginRoles";
import { getDeviceOnline } from "./deviceOnline";
import {
  isStaffSuspendedForLogin,
  listStaffCacheRecordsForAccount,
  readOfflineStaffCache,
} from "./offlineStaffCache";
import { logStaffCacheEvent } from "./staffCacheDiagnostics";

const REMEMBER_DEVICE_KEY = "waka.staff.remembered.v1";
const PENDING_STAFF_KEY = "waka.staff.pending.v1";
const STAFF_SESSION_KEY = "waka.staff.session.v1";

export const STAFF_CACHE_MISSING_MESSAGE =
  "No staff have been synchronized to this device yet. Connect to the internet once to download staff.";

export class StaffCacheMissingError extends Error {
  readonly code = "staff_cache_missing" as const;

  constructor(message = STAFF_CACHE_MISSING_MESSAGE) {
    super(message);
    this.name = "StaffCacheMissingError";
  }
}

export type PersistedStaffSession = {
  accountKey: string;
  businessName: string;
  staffId: string;
  staffName: string;
  role: UserRole;
};

type SnapshotLike = { preferences?: Partial<ShopPreferences> };

export type CachedShop = {
  accountKey: string;
  businessName: string;
  shopId?: string;
};

export type StaffLoginInput = {
  businessName: string;
  role: StaffLoginRole;
  identifier: string;
  pinOrPassword: string;
  rememberDevice: boolean;
};

export type StaffAuthResult = {
  accountKey: string;
  businessName: string;
  staffId: string;
  staffName: string;
  role: UserRole;
  identifier: string;
};

export type RememberedStaffDevice = {
  businessName: string;
  identifier: string;
};

function normalize(v: string): string {
  return v.trim().toLowerCase();
}

function readSnapshotBusinessName(snapshot: SnapshotLike): string {
  const p = snapshot.preferences;
  if (!p) return "";
  const name = String(p.shopDisplayName ?? "").trim();
  return name;
}

function keysEqual(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

function identifierMatches(
  staff: { id: string; name: string; username?: string | null; phone?: string | null },
  raw: string,
): boolean {
  const probe = normalize(raw);
  if (!probe) return false;
  if (normalize(staff.id) === probe) return true;
  if (normalize(staff.name) === probe) return true;
  if (staff.username && normalize(staff.username) === probe) return true;
  if (staff.phone && normalize(staff.phone) === probe) return true;
  return false;
}

async function resolveStaffRowsForShop(
  accountKey: string,
  shopId?: string | null,
): Promise<{ staffRows: StaffAccount[]; shopId: string | null; fromCache: boolean }> {
  const readCacheStaff = (record: { shopId: string; staff: StaffAccount[] }) => ({
    staffRows: record.staff,
    shopId: record.shopId,
    fromCache: true as const,
  });

  if (shopId) {
    const record = await readOfflineStaffCache(shopId, accountKey);
    if (record?.staff.length) return readCacheStaff(record);
  }

  const cacheRecords = await listStaffCacheRecordsForAccount(accountKey);
  if (cacheRecords.length > 0 && cacheRecords[0]!.staff.length > 0) {
    return readCacheStaff(cacheRecords[0]!);
  }

  const db = await getLocalDb();
  const snap = (await db.get("kv", `${accountKey}::snapshot`)) as SnapshotLike | undefined;
  const prefs = snap?.preferences;
  const staffRows = prefs?.staffAccounts ?? [];
  return { staffRows, shopId: shopId ?? null, fromCache: false };
}

async function findBlockedShopByBusinessName(businessName: string): Promise<CachedShop | null> {
  const db = await getLocalDb();
  const allKeys = await db.getAllKeys("kv");
  const { isOrganizationBlocked, hasWipeMarker } = await import("./organizationDeletionState");

  for (const key of allKeys) {
    if (typeof key !== "string" || !key.endsWith("::snapshot")) continue;
    const accountKey = key.slice(0, key.length - "::snapshot".length);
    if (!accountKey) continue;
    if (!isOrganizationBlocked(accountKey) && !hasWipeMarker(accountKey)) continue;
    const snapshot = (await db.get("kv", key)) as SnapshotLike | undefined;
    if (!snapshot?.preferences) continue;
    const name = readSnapshotBusinessName(snapshot);
    if (!name || !keysEqual(name, businessName)) continue;
    return { accountKey, businessName: name };
  }
  return null;
}

export async function listCachedShopsForStaffLogin(): Promise<CachedShop[]> {
  const db = await getLocalDb();
  const allKeys = await db.getAllKeys("kv");
  const shops = new Map<string, CachedShop>();
  const { isOrganizationBlocked, hasWipeMarker } = await import("./organizationDeletionState");

  for (const key of allKeys) {
    if (typeof key !== "string") continue;
    if (!key.endsWith("::snapshot")) continue;

    const accountKey = key.slice(0, key.length - "::snapshot".length);
    if (!accountKey) continue;
    if (isOrganizationBlocked(accountKey) || hasWipeMarker(accountKey)) continue;
    const snapshot = (await db.get("kv", key)) as SnapshotLike | undefined;
    if (!snapshot?.preferences) continue;
    const businessName = readSnapshotBusinessName(snapshot);
    if (!businessName) continue;

    const cacheRecords = await listStaffCacheRecordsForAccount(accountKey);
    const cacheRecord = cacheRecords.find((r) => keysEqual(r.businessName ?? "", businessName)) ?? cacheRecords[0];
    const hasStaff =
      (cacheRecord?.staff.length ?? 0) > 0 || (snapshot.preferences.staffAccounts?.length ?? 0) > 0;
    if (!hasStaff) continue;

    shops.set(accountKey, {
      accountKey,
      businessName,
      shopId: cacheRecord?.shopId,
    });
  }

  return [...shops.values()].sort((a, b) => a.businessName.localeCompare(b.businessName));
}

async function findStaffShopByBusinessName(businessName: string): Promise<CachedShop | null> {
  const shops = await listCachedShopsForStaffLogin();
  return shops.find((shop) => keysEqual(shop.businessName, businessName)) ?? null;
}

export async function isStaffCacheMissingOffline(accountKey: string, shopId?: string | null): Promise<boolean> {
  if (getDeviceOnline()) return false;
  const { staffRows, fromCache } = await resolveStaffRowsForShop(accountKey, shopId);
  return !fromCache && staffRows.length === 0;
}

export async function authenticateOfflineStaff(input: StaffLoginInput): Promise<StaffAuthResult> {
  const businessName = input.businessName.trim();
  const identifier = input.identifier.trim();
  const secret = input.pinOrPassword.trim();
  if (!businessName || !identifier || !secret) {
    throw new Error("Enter shop name, your name, and 4-digit PIN.");
  }
  const secretDigits = normalizePin(secret);
  if (/^\d+$/.test(secret.trim()) && secretDigits.length !== 4) {
    throw new Error("PIN must be exactly 4 digits.");
  }

  const shop = await findStaffShopByBusinessName(businessName);
  if (!shop) {
    const blocked = await findBlockedShopByBusinessName(businessName);
    if (blocked) {
      const { ORGANIZATION_DELETED_MESSAGE } = await import("./organizationDeletionState");
      throw new Error(ORGANIZATION_DELETED_MESSAGE);
    }
    if (!getDeviceOnline()) {
      logStaffCacheEvent("staff_cache_missing", { businessName, reason: "shop_not_found_offline" });
      throw new StaffCacheMissingError();
    }
    throw new Error("Business not found on this device. Owner must sign in once on this device first.");
  }

  const { isOrganizationBlocked, ORGANIZATION_DELETED_MESSAGE, hasWipeMarker } = await import(
    "./organizationDeletionState"
  );
  if (isOrganizationBlocked(shop.accountKey) || hasWipeMarker(shop.accountKey)) {
    throw new Error(ORGANIZATION_DELETED_MESSAGE);
  }

  const { staffRows, shopId, fromCache } = await resolveStaffRowsForShop(shop.accountKey, shop.shopId);

  if (staffRows.length === 0 && !getDeviceOnline()) {
    logStaffCacheEvent("staff_cache_missing", { accountKey: shop.accountKey, shopId: shopId ?? null });
    throw new StaffCacheMissingError();
  }

  const candidate = staffRows.find((s) =>
    identifierMatches({ id: s.id, name: s.name, username: s.username, phone: s.phone }, identifier),
  );

  if (!candidate) {
    if (staffRows.length === 0 && !getDeviceOnline()) {
      logStaffCacheEvent("staff_cache_missing", { accountKey: shop.accountKey, shopId: shopId ?? null });
      throw new StaffCacheMissingError();
    }
    throw new Error("Invalid staff credentials.");
  }

  if (!candidate.active || isStaffSuspendedForLogin(candidate)) {
    throw new Error("Invalid staff credentials.");
  }

  if (isStaffLoginLocked(candidate)) {
    throw new Error("Too many failed attempts. Try again later.");
  }

  const effectiveShopId = shopId ?? shop.shopId ?? null;
  if (effectiveShopId) {
    const { assertStaffLoginDeviceApproved, recordStaffLoginAttemptLocal } = await import("./staffLoginSecurity");
    const deviceCheck = await assertStaffLoginDeviceApproved(effectiveShopId);
    if (!deviceCheck.ok) {
      const { logStaffSecurityAudit } = await import("./staffSecurityAudit");
      logStaffSecurityAudit("staff_login_rejected_device", {
        staffId: candidate.id,
        staffName: candidate.name,
        shopId: effectiveShopId,
        reason: deviceCheck.error,
      });
      throw new Error(deviceCheck.error);
    }

    const secretOk = await staffSecretMatchesAsync(
      {
        pin: candidate.pin,
        password: candidate.password,
        pinHash: candidate.pinHash,
        passwordHash: candidate.passwordHash,
      },
      secret,
    );

    if (!secretOk) {
      const attempt = await recordStaffLoginAttemptLocal({
        accountKey: shop.accountKey,
        shopId: effectiveShopId,
        staff: candidate,
        success: false,
        online: getDeviceOnline(),
      });
      if (attempt.lockedUntil && Date.parse(attempt.lockedUntil) > Date.now()) {
        throw new Error("Too many failed attempts. Try again later.");
      }
      throw new Error("Invalid staff credentials.");
    }

    const migration = await migrateStaffSecretsAfterLogin(
      {
        pinHash: candidate.pinHash,
        passwordHash: candidate.passwordHash,
      },
      secret,
    );

    await recordStaffLoginAttemptLocal({
      accountKey: shop.accountKey,
      shopId: effectiveShopId,
      staff: {
        ...candidate,
        pinHash: migration.pinHash ?? candidate.pinHash,
        passwordHash: migration.passwordHash ?? candidate.passwordHash,
      },
      success: true,
      online: getDeviceOnline(),
    });

    if (migration.migrated) {
      const { pushStaffToCloud } = await import("./shopStaffCloud");
      void pushStaffToCloud({
        ...candidate,
        pinHash: migration.pinHash ?? candidate.pinHash,
        passwordHash: migration.passwordHash ?? candidate.passwordHash,
        pinChangedAt: migration.pinHash ? new Date().toISOString() : candidate.pinChangedAt,
        passwordChangedAt: migration.passwordHash ? new Date().toISOString() : candidate.passwordChangedAt,
      });
    }

    void import("./staffLoginSecurity").then(({ flushPendingStaffSecurityEvents }) => {
      flushPendingStaffSecurityEvents();
    });
  } else {
    const secretOk = await staffSecretMatchesAsync(
      {
        pin: candidate.pin,
        password: candidate.password,
        pinHash: candidate.pinHash,
        passwordHash: candidate.passwordHash,
      },
      secret,
    );
    if (!secretOk) {
      throw new Error("Invalid staff credentials.");
    }
  }

  logStaffCacheEvent(getDeviceOnline() ? "staff_login_online" : "staff_login_offline", {
    accountKey: shop.accountKey,
    staffId: candidate.id,
    fromCache,
  });

  const found = candidate;

  const role = normalizeUserRole(found.role) ?? found.role;
  const result: StaffAuthResult = {
    accountKey: shop.accountKey,
    businessName: shop.businessName,
    staffId: found.id,
    staffName: found.name,
    role,
    identifier,
  };

  if (input.rememberDevice && typeof window !== "undefined") {
    window.localStorage.setItem(
      REMEMBER_DEVICE_KEY,
      JSON.stringify({ businessName: result.businessName, identifier: result.identifier }),
    );
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      PENDING_STAFF_KEY,
      JSON.stringify({ accountKey: result.accountKey, staffId: result.staffId }),
    );
    if (input.rememberDevice) {
      writeStaffSession({
        accountKey: result.accountKey,
        businessName: result.businessName,
        staffId: result.staffId,
        staffName: result.staffName,
        role: result.role,
      });
    } else {
      clearStaffSession();
    }
  }

  return result;
}

export function writeStaffSession(session: PersistedStaffSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session));
}

export function readStaffSession(): PersistedStaffSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STAFF_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedStaffSession>;
    if (!parsed.accountKey || !parsed.staffId || !parsed.staffName || !parsed.role) return null;
    const role = normalizeUserRole(parsed.role);
    if (!role) return null;
    return { ...parsed, role } as PersistedStaffSession;
  } catch {
    return null;
  }
}

export function clearStaffSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STAFF_SESSION_KEY);
}

/** Clears offline staff login markers (session + pending selection). */
export function clearStaffAuth(): void {
  clearStaffSession();
  clearPendingStaffSelection();
}

export function readRememberedStaffDevice(): RememberedStaffDevice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REMEMBER_DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedStaffDevice>;
    if (!parsed.businessName || !parsed.identifier) return null;
    return { businessName: parsed.businessName, identifier: parsed.identifier };
  } catch {
    return null;
  }
}

export function clearRememberedStaffDevice(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REMEMBER_DEVICE_KEY);
}

export function clearPendingStaffSelection(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PENDING_STAFF_KEY);
}

export function readPendingStaffSelection():
  | {
      accountKey: string;
      staffId: string;
    }
  | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_STAFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accountKey?: string; staffId?: string };
    if (!parsed.accountKey || !parsed.staffId) return null;
    return { accountKey: parsed.accountKey, staffId: parsed.staffId };
  } catch {
    return null;
  }
}
