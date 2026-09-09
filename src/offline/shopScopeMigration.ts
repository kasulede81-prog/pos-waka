/**
 * MB-1 — one-time migration of legacy account-only IndexedDB rows to shop-scoped namespace.
 * Never assigns legacy data to an uncertain shop.
 *
 * WAKA-08: legacy KV rows are moved (copy then delete) and claimed once per account.
 * A second shop must not inherit the first shop's leftover unscoped snapshot.
 */

import type { SyncOperation } from "../types";
import { getActiveAccountKey } from "./accountScope";
import {
  buildPersistenceNamespace,
  isValidShopId,
  parseShopIdFromPersistenceNamespace,
} from "./shopScope";
import { getLocalDb } from "./localDb";

const LEGACY_CLAIM_PREFIX = "waka.mb1.shop-scope.legacy-claimed.v1";

export type ShopScopeMigrationReason =
  | "already_done"
  | "scoped_exists"
  | "no_legacy"
  | "copied"
  | "invalid_shop"
  | "claimed_elsewhere";

function persistenceFlagsUnavailable(): boolean {
  try {
    return typeof localStorage === "undefined";
  } catch {
    return true;
  }
}

function legacyClaimKey(accountKey: string): string {
  return `${LEGACY_CLAIM_PREFIX}::${accountKey}`;
}

function readLegacyClaimedBy(accountKey: string): string | null {
  if (persistenceFlagsUnavailable()) return null;
  try {
    const raw = localStorage.getItem(legacyClaimKey(accountKey));
    if (!raw) return null;
    const shopId = raw.trim();
    return isValidShopId(shopId) ? shopId : null;
  } catch {
    return null;
  }
}

function writeLegacyClaimedBy(accountKey: string, shopId: string): void {
  if (persistenceFlagsUnavailable()) return;
  try {
    localStorage.setItem(legacyClaimKey(accountKey), shopId);
  } catch {
    /* ignore */
  }
}

function legacyPrefixFor(accountKey: string): string {
  return `${accountKey}::`;
}

function isLegacyUnscopedKvKey(key: string, accountKey: string): boolean {
  return key.startsWith(legacyPrefixFor(accountKey));
}

function legacyHasData(kvKeys: string[], accountKey: string): boolean {
  return kvKeys.some((k) => isLegacyUnscopedKvKey(String(k), accountKey));
}

function scopedHasData(kvKeys: string[], scopedPrefix: string): boolean {
  return kvKeys.some((k) => String(k).startsWith(scopedPrefix));
}

/** Shop UUID already occupying a scoped KV partition for this account, other than `shopId`. */
function firstOtherShopWithScopedKv(kvKeys: string[], accountKey: string, shopId: string): string | null {
  const accountPrefix = `${accountKey}:`;
  for (const raw of kvKeys) {
    const key = String(raw);
    if (isLegacyUnscopedKvKey(key, accountKey)) continue;
    if (!key.startsWith(accountPrefix)) continue;
    const rest = key.slice(accountPrefix.length);
    const sep = rest.indexOf("::");
    if (sep <= 0) continue;
    const other = rest.slice(0, sep);
    if (isValidShopId(other) && other !== shopId) return other;
  }
  return null;
}

async function deleteLegacyUnscopedKv(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  kvKeys: string[],
  accountKey: string,
): Promise<void> {
  if (!legacyHasData(kvKeys, accountKey)) return;
  const tx = db.transaction("kv", "readwrite");
  for (const key of kvKeys) {
    if (!isLegacyUnscopedKvKey(key, accountKey)) continue;
    await tx.store.delete(key);
  }
  await tx.done;
}

/**
 * Move legacy `sb:userId::` rows into `sb:userId:shopId::` when ownership is provable.
 * Legacy KV is claimed at most once per account. Idempotent; safe to call on every bootstrap.
 */
export async function migrateLegacyPersistenceToShop(shopId: string): Promise<{
  migrated: boolean;
  reason: ShopScopeMigrationReason;
}> {
  const accountKey = getActiveAccountKey();
  if (!accountKey || !isValidShopId(shopId)) {
    return { migrated: false, reason: "invalid_shop" };
  }

  // Same skip as the previous window-gated path: no durable claim flag → do not guess.
  if (persistenceFlagsUnavailable()) {
    return { migrated: false, reason: "already_done" };
  }

  const claimedBy = readLegacyClaimedBy(accountKey);
  const db = await getLocalDb();
  const readKeys = async () => (await db.getAllKeys("kv")).map(String);

  const dropLeftoverLegacy = async () => {
    await deleteLegacyUnscopedKv(db, await readKeys(), accountKey);
  };

  if (claimedBy && claimedBy !== shopId) {
    await dropLeftoverLegacy();
    return { migrated: false, reason: "claimed_elsewhere" };
  }

  if (claimedBy === shopId) {
    await dropLeftoverLegacy();
    return { migrated: false, reason: "already_done" };
  }

  const scopedNs = buildPersistenceNamespace(accountKey, shopId);
  const scopedPrefix = `${scopedNs}::`;
  const legacyPrefix = legacyPrefixFor(accountKey);
  let kvKeys = await readKeys();

  const otherShop = firstOtherShopWithScopedKv(kvKeys, accountKey, shopId);
  if (otherShop) {
    writeLegacyClaimedBy(accountKey, otherShop);
    await dropLeftoverLegacy();
    return { migrated: false, reason: "claimed_elsewhere" };
  }

  if (scopedHasData(kvKeys, scopedPrefix)) {
    writeLegacyClaimedBy(accountKey, shopId);
    await dropLeftoverLegacy();
    return { migrated: false, reason: "scoped_exists" };
  }

  if (!legacyHasData(kvKeys, accountKey)) {
    return { migrated: false, reason: "no_legacy" };
  }

  const txKv = db.transaction("kv", "readwrite");
  for (const key of kvKeys) {
    if (!isLegacyUnscopedKvKey(key, accountKey)) continue;
    const suffix = key.slice(legacyPrefix.length);
    const value = await txKv.store.get(key);
    if (value !== undefined) {
      await txKv.store.put(value, `${scopedPrefix}${suffix}`);
      await txKv.store.delete(key);
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

  writeLegacyClaimedBy(accountKey, shopId);
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
