import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AuditLogEntry,
  Customer,
  DayCloseSummary,
  DebtPayment,
  Product,
  Purchase,
  ReturnRecord,
  CashExpense,
  CashDrawerAdjustment,
  DayDrawerOpen,
  InventoryCountSession,
  Sale,
  ShopPreferences,
  StockMovement,
  Supplier,
  SupplierPayment,
  SyncOperation,
  VoidRecord,
} from "../types";
import { getActiveAccountKey } from "./accountScope";

/**
 * IndexedDB layout (multi-account safe):
 *
 *   DB:  `waka-pos-offline`
 *   Stores:
 *     - `kv`        keys: `${accountKey}::snapshot`, `${accountKey}::last_good_snapshot`,
 *                          `${accountKey}::draft_sale`, ...
 *                   Legacy unscoped keys (`snapshot`, `last_good_snapshot`, `draft_sale`)
 *                   are read once by the first account that signs in via
 *                   `claimLegacySnapshotForCurrentAccount`, then ignored.
 *     - `syncQueue` keyPath `id`, each row carries `accountKey` and is filtered
 *                   to the active account on read.
 *     - `backups`   keyPath `id`, each row carries `accountKey` and is filtered
 *                   to the active account on list / read.
 *
 * Reads when no account is active return `null` / `[]`; writes are silently
 * dropped. This guarantees a signed-out tab can never overwrite a previous
 * user's data.
 */

const DB_NAME = "waka-pos-offline";
const DB_VERSION = 4;

const LEGACY_SNAPSHOT_KEY = "snapshot";
const LEGACY_LAST_GOOD_KEY = "last_good_snapshot";

const LEGACY_CLAIMED_FLAG = "waka.legacy.idb.snapshot.claimed.v1";

export type PersistedSnapshot = {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  preferences: ShopPreferences;
  debtPayments: DebtPayment[];
  dayCloses: DayCloseSummary[];
  auditLogs?: AuditLogEntry[];
  suppliers?: Supplier[];
  purchases?: Purchase[];
  supplierPayments?: SupplierPayment[];
  stockMovements?: StockMovement[];
  archivedStockMovements?: StockMovement[];
  voidRecords?: VoidRecord[];
  returnRecords?: ReturnRecord[];
  cashExpenses?: CashExpense[];
  cashDrawerAdjustments?: CashDrawerAdjustment[];
  dayDrawerOpens?: DayDrawerOpen[];
  inventoryCountSessions?: InventoryCountSession[];
  archivedSales?: Sale[];
  archivedAuditLogs?: AuditLogEntry[];
  archivedDayCloses?: DayCloseSummary[];
  archivedVoidRecords?: VoidRecord[];
  archivedReturnRecords?: ReturnRecord[];
  /** Product IDs tombstoned (deletion durability for backup/restore/sync). */
  deletedProductIds?: string[];
  /** Sale IDs voided/tombstoned (deletion durability for backup/restore/sync). */
  voidedSaleIds?: string[];
  updatedAt: string;
};

/** Full snapshot copy for rotation / manual restore */
export type LocalBackupRecord = {
  id: string;
  kind: "daily_auto" | "manual";
  createdAt: string;
  /** For daily_auto: Kampala date key */
  dateKey?: string;
  snapshot: PersistedSnapshot;
  /** Account this backup belongs to. Legacy rows may omit it (filtered out). */
  accountKey?: string;
};

type WakaDB = DBSchema & {
  kv: {
    key: string;
    value: unknown;
  };
  syncQueue: {
    key: string;
    value: SyncOperation;
    indexes: { byCreated: string };
  };
  backups: {
    key: string;
    value: LocalBackupRecord;
    indexes: { byCreated: string };
  };
  records: {
    key: string;
    value: import("./entityStore").EntityRow;
    indexes: {
      byAccountKey: string;
      byBucket: import("./entityStore").EntityBucket;
      byAccountBucket: [string, import("./entityStore").EntityBucket];
    };
  };
};

let dbPromise: Promise<IDBPDatabase<WakaDB>> | null = null;

function isSnapshotShape(v: unknown): v is PersistedSnapshot {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.products) && Array.isArray(o.sales) && typeof o.preferences === "object";
}

function scopedKey(name: string): string | null {
  const acc = getActiveAccountKey();
  if (!acc) return null;
  if (acc.startsWith("demo:")) return null;
  return `${acc}::${name}`;
}

/** Open IndexedDB early (e.g. from main.tsx) so first sign-in reads faster. */
export function warmupLocalDb(): void {
  void getLocalDb();
}

export function getLocalDb(): Promise<IDBPDatabase<WakaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WakaDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        if (!database.objectStoreNames.contains("kv")) {
          database.createObjectStore("kv");
        }
        if (!database.objectStoreNames.contains("syncQueue")) {
          const q = database.createObjectStore("syncQueue", { keyPath: "id" });
          q.createIndex("byCreated", "createdAt");
        }
        if (oldVersion < 2 && !database.objectStoreNames.contains("backups")) {
          const b = database.createObjectStore("backups", { keyPath: "id" });
          b.createIndex("byCreated", "createdAt");
        }
        if (!database.objectStoreNames.contains("records")) {
          database.createObjectStore("records", { keyPath: "key" });
        }
        const recordsStore = transaction.objectStore("records");
        if (!recordsStore.indexNames.contains("byAccountKey")) {
          recordsStore.createIndex("byAccountKey", "accountKey", { unique: false });
        }
        if (!recordsStore.indexNames.contains("byBucket")) {
          recordsStore.createIndex("byBucket", "bucket", { unique: false });
        }
        if (!recordsStore.indexNames.contains("byAccountBucket")) {
          recordsStore.createIndex("byAccountBucket", ["accountKey", "bucket"], { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

export async function readKv<T>(key: string): Promise<T | null> {
  const k = scopedKey(key);
  if (!k) return null;
  try {
    const db = await getLocalDb();
    const row = await db.get("kv", k);
    return (row ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function writeKv(key: string, value: unknown): Promise<void> {
  const k = scopedKey(key);
  if (!k) return;
  const db = await getLocalDb();
  await db.put("kv", value, k);
}

export async function deleteKv(key: string): Promise<void> {
  const k = scopedKey(key);
  if (!k) return;
  const db = await getLocalDb();
  await db.delete("kv", k);
}

async function readScopedSnapshot(): Promise<Partial<PersistedSnapshot> | null> {
  const k = scopedKey(LEGACY_SNAPSHOT_KEY);
  if (!k) return null;
  try {
    const db = await getLocalDb();
    const row = await db.get("kv", k);
    if (!row) return null;
    return row as Partial<PersistedSnapshot>;
  } catch {
    return null;
  }
}

async function readScopedLastGood(): Promise<Partial<PersistedSnapshot> | null> {
  const k = scopedKey(LEGACY_LAST_GOOD_KEY);
  if (!k) return null;
  try {
    const db = await getLocalDb();
    const row = await db.get("kv", k);
    if (!row) return null;
    return row as Partial<PersistedSnapshot>;
  } catch {
    return null;
  }
}

export async function readSnapshot(): Promise<Partial<PersistedSnapshot> | null> {
  return readScopedSnapshot();
}

/** If main snapshot is missing or corrupt, fall back to last known-good copy. */
export async function readSnapshotWithFallback(): Promise<Partial<PersistedSnapshot> | null> {
  const main = await readScopedSnapshot();
  if (main && isSnapshotShape(main)) return main;
  const fb = await readScopedLastGood();
  if (fb && isSnapshotShape(fb)) return fb;
  return main;
}

/**
 * One-time claim of any legacy (pre-namespacing) snapshot for the current
 * signed-in account. Subsequent users will NOT inherit the legacy data — they
 * start fresh. This prevents cross-user merge while keeping the first user's
 * existing data intact.
 *
 * Returns the legacy snapshot if it was claimed in this call, otherwise null.
 */
export async function claimLegacySnapshotForCurrentAccount(): Promise<Partial<PersistedSnapshot> | null> {
  const acc = getActiveAccountKey();
  if (!acc) return null;
  if (typeof window === "undefined") return null;
  let claimed: { accountKey?: string } | null = null;
  try {
    const raw = window.localStorage.getItem(LEGACY_CLAIMED_FLAG);
    if (raw) claimed = JSON.parse(raw) as { accountKey?: string };
  } catch {
    /* ignore */
  }
  if (claimed?.accountKey) return null;
  try {
    const db = await getLocalDb();
    const legacy = (await db.get("kv", LEGACY_SNAPSHOT_KEY)) as Partial<PersistedSnapshot> | undefined;
    if (!legacy || !isSnapshotShape(legacy)) {
      window.localStorage.setItem(LEGACY_CLAIMED_FLAG, JSON.stringify({ accountKey: acc, at: new Date().toISOString(), empty: true }));
      return null;
    }
    const tx = db.transaction("kv", "readwrite");
    await tx.objectStore("kv").put(legacy, `${acc}::${LEGACY_SNAPSHOT_KEY}`);
    const legacyFb = (await db.get("kv", LEGACY_LAST_GOOD_KEY)) as Partial<PersistedSnapshot> | undefined;
    if (legacyFb && isSnapshotShape(legacyFb)) {
      await tx.objectStore("kv").put(legacyFb, `${acc}::${LEGACY_LAST_GOOD_KEY}`);
    }
    await tx.objectStore("kv").delete(LEGACY_SNAPSHOT_KEY);
    await tx.objectStore("kv").delete(LEGACY_LAST_GOOD_KEY);
    await tx.done;
    window.localStorage.setItem(LEGACY_CLAIMED_FLAG, JSON.stringify({ accountKey: acc, at: new Date().toISOString() }));
    return legacy;
  } catch {
    return null;
  }
}

export type WriteSnapshotOptions = {
  /** Skip rotating the previous snapshot into last-good (faster full restore). */
  skipLastGood?: boolean;
};

export async function writeSnapshot(
  data: Omit<PersistedSnapshot, "updatedAt">,
  opts?: WriteSnapshotOptions,
): Promise<void> {
  const mainKey = scopedKey(LEGACY_SNAPSHOT_KEY);
  const fbKey = scopedKey(LEGACY_LAST_GOOD_KEY);
  if (!mainKey || !fbKey) return;
  const db = await getLocalDb();
  const tx = db.transaction("kv", "readwrite");
  const kv = tx.objectStore("kv");
  const skipLastGood = opts?.skipLastGood === true;
  if (!skipLastGood) {
    try {
      const prev = await kv.get(mainKey);
      if (prev && isSnapshotShape(prev)) {
        await kv.put(prev, fbKey);
      }
    } catch {
      /* ignore */
    }
  }
  const next: PersistedSnapshot = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  await kv.put(next, mainKey);
  await tx.done;
}

export async function readSyncQueue(): Promise<SyncOperation[]> {
  const acc = getActiveAccountKey();
  if (!acc) return [];
  const db = await getLocalDb();
  const all = await db.getAll("syncQueue");
  return all.filter((op) => (op as SyncOperation & { accountKey?: string }).accountKey === acc);
}

export async function appendSyncOperation(op: SyncOperation): Promise<void> {
  const acc = getActiveAccountKey();
  if (!acc) return;
  const db = await getLocalDb();
  const row: SyncOperation & { accountKey: string } = { ...op, accountKey: acc };
  await db.put("syncQueue", row);
}

export async function removeSyncOperation(id: string): Promise<void> {
  const db = await getLocalDb();
  await db.delete("syncQueue", id);
}

export async function clearSyncQueue(): Promise<void> {
  const acc = getActiveAccountKey();
  if (!acc) return;
  const db = await getLocalDb();
  const all = await db.getAll("syncQueue");
  const tx = db.transaction("syncQueue", "readwrite");
  for (const op of all) {
    if ((op as SyncOperation & { accountKey?: string }).accountKey === acc) {
      await tx.objectStore("syncQueue").delete(op.id);
    }
  }
  await tx.done;
}

export type RestoreQueueArchiveEntry = {
  archivedAt: string;
  operations: SyncOperation[];
};

function restoreQueueArchiveKey(accountKey: string): string {
  return `${accountKey}::restore_queue_archive`;
}

/** Move pending sync ops to archive and clear queue — used after backup restore. */
export async function archiveAndClearSyncQueue(): Promise<{ clearedCount: number; archivedCount: number }> {
  const acc = getActiveAccountKey();
  if (!acc) return { clearedCount: 0, archivedCount: 0 };
  const queue = await readSyncQueue();
  const clearedCount = queue.length;
  if (clearedCount === 0) return { clearedCount: 0, archivedCount: 0 };

  const db = await getLocalDb();
  const key = restoreQueueArchiveKey(acc);
  const existing = (await db.get("kv", key)) as RestoreQueueArchiveEntry[] | undefined;
  const entry: RestoreQueueArchiveEntry = {
    archivedAt: new Date().toISOString(),
    operations: queue,
  };
  const nextArchive = [entry, ...(existing ?? [])].slice(0, 10);
  await db.put("kv", nextArchive, key);
  await clearSyncQueue();
  return { clearedCount, archivedCount: clearedCount };
}

export async function countArchivedRestoreQueueOps(): Promise<number> {
  const acc = getActiveAccountKey();
  if (!acc) return 0;
  const db = await getLocalDb();
  const archives = (await db.get("kv", restoreQueueArchiveKey(acc))) as RestoreQueueArchiveEntry[] | undefined;
  if (!archives?.length) return 0;
  return archives.reduce((sum, entry) => sum + entry.operations.length, 0);
}

export async function appendBackupRecord(rec: LocalBackupRecord): Promise<void> {
  const acc = getActiveAccountKey();
  if (!acc) return;
  const db = await getLocalDb();
  await db.put("backups", { ...rec, accountKey: acc });
}

export async function listBackupRecords(): Promise<LocalBackupRecord[]> {
  const acc = getActiveAccountKey();
  if (!acc) return [];
  const db = await getLocalDb();
  if (!db.objectStoreNames.contains("backups")) return [];
  const all = await db.getAll("backups");
  return all
    .filter((r) => r.accountKey === acc)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getBackupRecord(id: string): Promise<LocalBackupRecord | null> {
  const acc = getActiveAccountKey();
  if (!acc) return null;
  const db = await getLocalDb();
  if (!db.objectStoreNames.contains("backups")) return null;
  const row = (await db.get("backups", id)) ?? null;
  if (!row) return null;
  return row.accountKey === acc ? row : null;
}

export async function deleteBackupRecord(id: string): Promise<void> {
  const db = await getLocalDb();
  if (!db.objectStoreNames.contains("backups")) return;
  await db.delete("backups", id);
}

export type AccountIdbWipeSummary = {
  kvKeysRemoved: number;
  recordsRemoved: number;
  syncQueueRemoved: number;
  backupsRemoved: number;
};

const ACCOUNT_KV_SUFFIXES = [
  LEGACY_SNAPSHOT_KEY,
  LEGACY_LAST_GOOD_KEY,
  "draft_sale",
  "entity-manifest",
  "restore_queue_archive",
] as const;

/** List distinct account keys found in IndexedDB (kv + records + queue + backups). */
export async function listAccountKeysInIndexedDb(): Promise<string[]> {
  const keys = new Set<string>();
  try {
    const db = await getLocalDb();
    const kvKeys = await db.getAllKeys("kv");
    for (const key of kvKeys) {
      const k = String(key);
      const sep = k.indexOf("::");
      if (sep > 0) keys.add(k.slice(0, sep));
    }
    const records = await db.getAll("records");
    for (const row of records) {
      const r = row as { accountKey?: string };
      if (r.accountKey) keys.add(r.accountKey);
    }
    const queue = await db.getAll("syncQueue");
    for (const op of queue) {
      const r = op as SyncOperation & { accountKey?: string };
      if (r.accountKey) keys.add(r.accountKey);
    }
    if (db.objectStoreNames.contains("backups")) {
      const backups = await db.getAll("backups");
      for (const b of backups) {
        if (b.accountKey) keys.add(b.accountKey);
      }
    }
  } catch {
    /* ignore */
  }
  return [...keys].sort();
}

export async function countBackupsForAccount(accountKey: string): Promise<number> {
  try {
    const db = await getLocalDb();
    if (!db.objectStoreNames.contains("backups")) return 0;
    const all = await db.getAll("backups");
    return all.filter((r) => r.accountKey === accountKey).length;
  } catch {
    return 0;
  }
}

export async function hasIndexedDbDataForAccount(accountKey: string): Promise<boolean> {
  try {
    const db = await getLocalDb();
    for (const suffix of ACCOUNT_KV_SUFFIXES) {
      const row = await db.get("kv", `${accountKey}::${suffix}`);
      if (row != null) return true;
    }
    const records = await db.getAll("records");
    if (records.some((r) => (r as { accountKey?: string }).accountKey === accountKey)) return true;
    const queue = await db.getAll("syncQueue");
    if (queue.some((op) => (op as SyncOperation & { accountKey?: string }).accountKey === accountKey)) return true;
    if (db.objectStoreNames.contains("backups")) {
      const backups = await db.getAll("backups");
      if (backups.some((b) => b.accountKey === accountKey)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Remove all IndexedDB rows for a single account namespace (idempotent). */
export async function wipeIndexedDbNamespace(accountKey: string): Promise<AccountIdbWipeSummary> {
  const summary: AccountIdbWipeSummary = {
    kvKeysRemoved: 0,
    recordsRemoved: 0,
    syncQueueRemoved: 0,
    backupsRemoved: 0,
  };
  if (!accountKey) return summary;

  try {
    const db = await getLocalDb();
    const kvKeys = await db.getAllKeys("kv");
    const prefix = `${accountKey}::`;
    const txKv = db.transaction("kv", "readwrite");
    for (const key of kvKeys) {
      const k = String(key);
      if (k === accountKey || k.startsWith(prefix)) {
        await txKv.store.delete(k);
        summary.kvKeysRemoved += 1;
      }
    }
    await txKv.done;

    const records = await db.getAll("records");
    const txRec = db.transaction("records", "readwrite");
    for (const row of records) {
      const r = row as { key: string; accountKey?: string };
      if (r.accountKey === accountKey) {
        await txRec.store.delete(r.key);
        summary.recordsRemoved += 1;
      }
    }
    await txRec.done;

    const queue = await db.getAll("syncQueue");
    const txQ = db.transaction("syncQueue", "readwrite");
    for (const op of queue) {
      const r = op as SyncOperation & { accountKey?: string };
      if (r.accountKey === accountKey) {
        await txQ.store.delete(op.id);
        summary.syncQueueRemoved += 1;
      }
    }
    await txQ.done;

    if (db.objectStoreNames.contains("backups")) {
      const backups = await db.getAll("backups");
      const txB = db.transaction("backups", "readwrite");
      for (const b of backups) {
        if (b.accountKey === accountKey) {
          await txB.store.delete(b.id);
          summary.backupsRemoved += 1;
        }
      }
      await txB.done;
    }
  } catch {
    /* idempotent — partial wipe is acceptable on error */
  }

  return summary;
}
