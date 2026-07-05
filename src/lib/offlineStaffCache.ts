/**
 * Encrypted read-only offline staff cache — separate from sync queues and preferences.
 */

import type { StaffAccount } from "../types";
import { getActiveAccountKey } from "../offline/accountScope";
import { getLocalDb } from "../offline/localDb";
import { getOrCreateDeviceId } from "./deviceId";
import { logStaffCacheEvent } from "./staffCacheDiagnostics";

export type OfflineStaffCacheRecord = {
  shopId: string;
  /** Trading name — used for staff login shop picker without owner session. */
  businessName?: string;
  version: number;
  downloadedAt: string;
  staff: StaffAccount[];
};

type EncryptedStaffCachePayload = {
  v: 1;
  iv: string;
  ciphertext: string;
};

const CACHE_STORE = "staffCache";

async function deriveCacheKey(shopId: string): Promise<CryptoKey> {
  const accountKey = getActiveAccountKey() ?? "anon";
  const material = `${getOrCreateDeviceId()}:${shopId}:${accountKey}:waka-staff-cache-v1`;
  const raw = new TextEncoder().encode(material);
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    keyBytes[i] = raw[i % raw.length]!;
  }
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function cacheDbKey(accountKey: string, shopId: string): string | null {
  if (!accountKey || accountKey.startsWith("demo:")) return null;
  return `${accountKey}::${shopId}`;
}

function cacheKeyForShop(shopId: string, accountKey?: string | null): string | null {
  const acc = accountKey ?? getActiveAccountKey();
  if (!acc) return null;
  return cacheDbKey(acc, shopId);
}

/** Strip plaintext secrets — cache stores hashes only. */
export function sanitizeStaffForCache(staff: StaffAccount[]): StaffAccount[] {
  return staff.map((row) => ({
    ...row,
    pin: null,
    password: null,
  }));
}

async function encryptRecord(record: OfflineStaffCacheRecord): Promise<EncryptedStaffCachePayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveCacheKey(record.shopId);
  const plaintext = JSON.stringify({
    ...record,
    staff: sanitizeStaffForCache(record.staff),
  });
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: 1,
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  };
}

async function decryptRecord(
  shopId: string,
  payload: EncryptedStaffCachePayload,
): Promise<OfflineStaffCacheRecord | null> {
  try {
    const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
    const data = Uint8Array.from(atob(payload.ciphertext), (c) => c.charCodeAt(0));
    const key = await deriveCacheKey(shopId);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as OfflineStaffCacheRecord;
    if (!parsed.shopId || !Array.isArray(parsed.staff)) return null;
    return { ...parsed, staff: sanitizeStaffForCache(parsed.staff) };
  } catch {
    return null;
  }
}

export async function readOfflineStaffCache(
  shopId: string,
  accountKey?: string | null,
): Promise<OfflineStaffCacheRecord | null> {
  const key = cacheKeyForShop(shopId, accountKey);
  if (!key) return null;
  try {
    const db = await getLocalDb();
    const row = (await db.get(CACHE_STORE, key)) as
      | { shopId: string; payload: EncryptedStaffCachePayload }
      | undefined;
    if (!row?.payload) return null;
    const record = await decryptRecord(row.shopId, row.payload);
    if (record) {
      logStaffCacheEvent("staff_cache_loaded", {
        shopId,
        version: record.version,
        count: record.staff.length,
      });
    }
    return record;
  } catch {
    return null;
  }
}

export async function listStaffCacheRecordsForAccount(
  accountKey: string,
): Promise<OfflineStaffCacheRecord[]> {
  if (!accountKey || accountKey.startsWith("demo:")) return [];
  try {
    const db = await getLocalDb();
    const keys = await db.getAllKeys(CACHE_STORE);
    const prefix = `${accountKey}::`;
    const records: OfflineStaffCacheRecord[] = [];
    for (const rawKey of keys) {
      const key = String(rawKey);
      if (!key.startsWith(prefix)) continue;
      const row = (await db.get(CACHE_STORE, key)) as
        | { shopId: string; payload: EncryptedStaffCachePayload }
        | undefined;
      if (!row?.payload) continue;
      const record = await decryptRecord(row.shopId, row.payload);
      if (record) records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

export async function writeOfflineStaffCache(
  record: OfflineStaffCacheRecord,
  accountKey?: string | null,
): Promise<void> {
  const key = cacheKeyForShop(record.shopId, accountKey);
  if (!key) return;
  const payload = await encryptRecord(record);
  const db = await getLocalDb();
  await db.put(CACHE_STORE, { shopId: record.shopId, payload }, key);
  logStaffCacheEvent("staff_cache_refresh", {
    shopId: record.shopId,
    version: record.version,
    count: record.staff.length,
  });
}

export async function hasOfflineStaffCache(shopId: string): Promise<boolean> {
  const cache = await readOfflineStaffCache(shopId);
  return (cache?.staff.length ?? 0) > 0;
}

export async function clearOfflineStaffCache(shopId: string, accountKey?: string | null): Promise<void> {
  const key = cacheKeyForShop(shopId, accountKey);
  if (!key) return;
  const db = await getLocalDb();
  await db.delete(CACHE_STORE, key);
}

export async function clearStaffCacheForAccount(accountKey: string): Promise<number> {
  if (!accountKey) return 0;
  try {
    const db = await getLocalDb();
    const keys = await db.getAllKeys(CACHE_STORE);
    const prefix = `${accountKey}::`;
    let removed = 0;
    const tx = db.transaction(CACHE_STORE, "readwrite");
    for (const rawKey of keys) {
      const key = String(rawKey);
      if (!key.startsWith(prefix)) continue;
      await tx.store.delete(key);
      removed += 1;
    }
    await tx.done;
    return removed;
  } catch {
    return 0;
  }
}

export async function listCachedStaffForLogin(
  shopId: string,
  accountKey?: string | null,
): Promise<StaffAccount[]> {
  const cache = await readOfflineStaffCache(shopId, accountKey);
  return cache?.staff.filter((s) => s.active && !isStaffSuspendedForLogin(s)) ?? [];
}

export function isStaffSuspendedForLogin(staff: StaffAccount): boolean {
  if (!staff.active) return true;
  if (staff.lockedUntil && Date.parse(staff.lockedUntil) > Date.now()) return true;
  return false;
}

export async function getCachedStaffVersion(shopId: string): Promise<number> {
  const cache = await readOfflineStaffCache(shopId);
  return cache?.version ?? 0;
}
