/**
 * MB-1 — one-time migration of legacy account-only IndexedDB rows to shop-scoped namespace.
 * Never assigns legacy data to an uncertain shop.
 */

import type { SyncOperation } from "../types";
import { getActiveAccountKey } from "./accountScope";
import {
  buildPersistenceNamespace,
  isValidShopId,
  parseShopIdFromPersistenceNamespace,
} from "./shopScope";
import { getLocalDb } from "./localDb";

const MIGRATION_FLAG_PREFIX = "waka.mb1.shop-scope.migrated.v1";

function migrationFlagKey(accountKey: string, shopId: string): string {
  return `${MIGRATION_FLAG_PREFIX}::${accountKey}::${shopId}`;
}

function isMigrationComplete(accountKey: string, shopId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(migrationFlagKey(accountKey, shopId)) === "1";
  } catch {
    return false;
  }
}

function markMigrationComplete(accountKey: string, shopId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(migrationFlagKey(accountKey, shopId), "1");
  } catch {
    /* ignore */
  }
}

function legacyHasData(kvKeys: string[], legacyPrefix: string): boolean {
  return kvKeys.some((k) => String(k).startsWith(legacyPrefix));
}

function scopedHasData(kvKeys: string[], scopedPrefix: string): boolean {
  return kvKeys.some((k) => String(k).startsWith(scopedPrefix));
}

/**
 * Copy legacy `sb:userId::` rows into `sb:userId:shopId::` when ownership is provable.
 * Idempotent; safe to call on every bootstrap.
 */
export async function migrateLegacyPersistenceToShop(shopId: string): Promise<{
  migrated: boolean;
  reason: "already_done" | "scoped_exists" | "no_legacy" | "copied" | "invalid_shop";
}> {
  const accountKey = getActiveAccountKey();
  if (!accountKey || !isValidShopId(shopId)) {
    return { migrated: false, reason: "invalid_shop" };
  }

  if (isMigrationComplete(accountKey, shopId)) {
    return { migrated: false, reason: "already_done" };
  }

  const legacyPrefix = `${accountKey}::`;
  const scopedNs = buildPersistenceNamespace(accountKey, shopId);
  const scopedPrefix = `${scopedNs}::`;

  const db = await getLocalDb();
  const kvKeys = (await db.getAllKeys("kv")).map(String);

  if (scopedHasData(kvKeys, scopedPrefix)) {
    markMigrationComplete(accountKey, shopId);
    return { migrated: false, reason: "scoped_exists" };
  }

  if (!legacyHasData(kvKeys, legacyPrefix)) {
    markMigrationComplete(accountKey, shopId);
    return { migrated: false, reason: "no_legacy" };
  }

  const txKv = db.transaction("kv", "readwrite");
  for (const key of kvKeys) {
    if (!key.startsWith(legacyPrefix)) continue;
    const suffix = key.slice(legacyPrefix.length);
    const value = await txKv.store.get(key);
    if (value !== undefined) {
      await txKv.store.put(value, `${scopedPrefix}${suffix}`);
    }
  }
  await txKv.done;

  const records = await db.getAll("records");
  const txRec = db.transaction("records", "readwrite");
  for (const row of records) {
    const r = row as { key: string; accountKey?: string };
    if (r.accountKey !== accountKey) continue;
    const updated = { ...row, accountKey: scopedNs, key: r.key.replace(`${accountKey}::`, `${scopedNs}::`) };
    await txRec.store.put(updated);
    if (updated.key !== r.key) await txRec.store.delete(r.key);
  }
  await txRec.done;

  const queue = await db.getAll("syncQueue");
  const txQ = db.transaction("syncQueue", "readwrite");
  for (const op of queue) {
    const row = op as SyncOperation & { accountKey?: string; shopId?: string };
    if (row.accountKey !== accountKey) continue;
    const stamped: SyncOperation & { accountKey: string; shopId: string } = {
      ...row,
      accountKey: scopedNs,
      shopId: row.shopId ?? shopId,
    };
    await txQ.store.put(stamped);
  }
  await txQ.done;

  if (db.objectStoreNames.contains("backups")) {
    const backups = await db.getAll("backups");
    const txB = db.transaction("backups", "readwrite");
    for (const b of backups) {
      if (b.accountKey !== accountKey) continue;
      await txB.store.put({ ...b, accountKey: scopedNs });
    }
    await txB.done;
  }

  markMigrationComplete(accountKey, shopId);
  return { migrated: true, reason: "copied" };
}

/** Infer shop from a legacy queue row — only when namespace embeds shop UUID. */
export function inferShopIdFromQueueRow(row: SyncOperation & { accountKey?: string }): string | null {
  if (row.shopId && isValidShopId(row.shopId)) return row.shopId;
  if (row.accountKey) {
    const fromNs = parseShopIdFromPersistenceNamespace(row.accountKey);
    if (fromNs) return fromNs;
  }
  return null;
}
