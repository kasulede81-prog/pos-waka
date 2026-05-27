import type { ShopPreferences, UserRole } from "../types";
import { getLocalDb } from "../offline/localDb";
import { hashStaffSecret, normalizePin } from "./staffSecret";

const REMEMBER_DEVICE_KEY = "waka.staff.remembered.v1";
const PENDING_STAFF_KEY = "waka.staff.pending.v1";

type SnapshotLike = { preferences?: Partial<ShopPreferences> };

export type CachedShop = {
  accountKey: string;
  businessName: string;
};

export type StaffLoginInput = {
  businessName: string;
  role: UserRole;
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

function identifierMatches(staff: { id: string; name: string; username?: string | null; phone?: string | null }, raw: string): boolean {
  const probe = normalize(raw);
  if (!probe) return false;
  if (normalize(staff.id) === probe) return true;
  if (normalize(staff.name) === probe) return true;
  if (staff.username && normalize(staff.username) === probe) return true;
  if (staff.phone && normalize(staff.phone) === probe) return true;
  return false;
}

function secretMatches(staff: { pin?: string | null; password?: string | null; pinHash?: string | null; passwordHash?: string | null }, raw: string): boolean {
  const probe = raw.trim();
  if (!probe) return false;
  const pin = normalizePin(staff.pin ?? "");
  const password = (staff.password ?? "").trim();
  const probePin = normalizePin(probe);
  const probeHash = hashStaffSecret(probe);
  const probePinHash = probePin ? hashStaffSecret(probePin) : "";
  const pinHash = (staff.pinHash ?? "").trim();
  const passwordHash = (staff.passwordHash ?? "").trim();
  return (
    (pin.length > 0 && pin === probePin) ||
    (password.length > 0 && password === probe) ||
    (pinHash.length > 0 && pinHash === probePinHash) ||
    (passwordHash.length > 0 && passwordHash === probeHash)
  );
}

export async function listCachedShopsForStaffLogin(): Promise<CachedShop[]> {
  const db = await getLocalDb();
  const allKeys = await db.getAllKeys("kv");
  const shops = new Map<string, CachedShop>();

  for (const key of allKeys) {
    if (typeof key !== "string") continue;
    if (!key.endsWith("::snapshot")) continue;

    const accountKey = key.slice(0, key.length - "::snapshot".length);
    if (!accountKey) continue;
    const snapshot = (await db.get("kv", key)) as SnapshotLike | undefined;
    if (!snapshot?.preferences) continue;
    const businessName = readSnapshotBusinessName(snapshot);
    if (!businessName) continue;
    if ((snapshot.preferences.staffAccounts?.length ?? 0) === 0) continue;
    shops.set(accountKey, { accountKey, businessName });
  }

  return [...shops.values()].sort((a, b) => a.businessName.localeCompare(b.businessName));
}

export async function authenticateOfflineStaff(input: StaffLoginInput): Promise<StaffAuthResult> {
  const businessName = input.businessName.trim();
  const identifier = input.identifier.trim();
  const secret = input.pinOrPassword.trim();
  if (!businessName || !identifier || !secret) {
    throw new Error("Enter business name, staff ID/username, and PIN/password.");
  }

  const shops = await listCachedShopsForStaffLogin();
  const shop = shops.find((s) => keysEqual(s.businessName, businessName));
  if (!shop) {
    throw new Error("Business not found on this device. Owner must sign in once on this device first.");
  }

  const db = await getLocalDb();
  const snap = (await db.get("kv", `${shop.accountKey}::snapshot`)) as SnapshotLike | undefined;
  const prefs = snap?.preferences;
  const staffRows = prefs?.staffAccounts ?? [];
  const found = staffRows.find(
    (s) =>
      s.active &&
      s.role === input.role &&
      identifierMatches({ id: s.id, name: s.name, username: s.username, phone: s.phone }, identifier) &&
      secretMatches({ pin: s.pin, password: s.password, pinHash: s.pinHash, passwordHash: s.passwordHash }, secret),
  );

  if (!found) {
    throw new Error("Invalid staff credentials.");
  }

  const result: StaffAuthResult = {
    accountKey: shop.accountKey,
    businessName: shop.businessName,
    staffId: found.id,
    staffName: found.name,
    role: found.role,
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
  }

  return result;
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
