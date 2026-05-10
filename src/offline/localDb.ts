import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AuditLogEntry,
  Customer,
  DayCloseSummary,
  DebtPayment,
  Product,
  Purchase,
  Sale,
  ShopPreferences,
  StockMovement,
  Supplier,
  SupplierPayment,
  SyncOperation,
} from "../types";

const DB_NAME = "waka-pos-offline";
const DB_VERSION = 2;

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
};

let dbPromise: Promise<IDBPDatabase<WakaDB>> | null = null;

function isSnapshotShape(v: unknown): v is PersistedSnapshot {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.products) && Array.isArray(o.sales) && typeof o.preferences === "object";
}

export function getLocalDb(): Promise<IDBPDatabase<WakaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WakaDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
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
      },
    });
  }
  return dbPromise;
}

export async function readKv<T>(key: string): Promise<T | null> {
  try {
    const db = await getLocalDb();
    const row = await db.get("kv", key);
    return (row ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function writeKv(key: string, value: unknown): Promise<void> {
  const db = await getLocalDb();
  await db.put("kv", value, key);
}

export async function deleteKv(key: string): Promise<void> {
  const db = await getLocalDb();
  await db.delete("kv", key);
}

export async function readSnapshot(): Promise<Partial<PersistedSnapshot> | null> {
  try {
    const db = await getLocalDb();
    const row = await db.get("kv", "snapshot");
    if (!row) return null;
    return row as Partial<PersistedSnapshot>;
  } catch {
    return null;
  }
}

/** If main snapshot is missing or corrupt, fall back to last known-good copy. */
export async function readSnapshotWithFallback(): Promise<Partial<PersistedSnapshot> | null> {
  const main = await readSnapshot();
  if (main && isSnapshotShape(main)) return main;
  try {
    const db = await getLocalDb();
    const fb = await db.get("kv", "last_good_snapshot");
    if (fb && isSnapshotShape(fb)) return fb as Partial<PersistedSnapshot>;
  } catch {
    /* ignore */
  }
  return main;
}

export async function writeSnapshot(data: Omit<PersistedSnapshot, "updatedAt">): Promise<void> {
  const db = await getLocalDb();
  const tx = db.transaction("kv", "readwrite");
  const kv = tx.objectStore("kv");
  try {
    const prev = await kv.get("snapshot");
    if (prev && isSnapshotShape(prev)) {
      await kv.put(prev, "last_good_snapshot");
    }
  } catch {
    /* ignore */
  }
  const next: PersistedSnapshot = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  await kv.put(next, "snapshot");
  await tx.done;
}

export async function readSyncQueue(): Promise<SyncOperation[]> {
  const db = await getLocalDb();
  return db.getAll("syncQueue");
}

export async function appendSyncOperation(op: SyncOperation): Promise<void> {
  const db = await getLocalDb();
  await db.put("syncQueue", op);
}

export async function removeSyncOperation(id: string): Promise<void> {
  const db = await getLocalDb();
  await db.delete("syncQueue", id);
}

export async function clearSyncQueue(): Promise<void> {
  const db = await getLocalDb();
  await db.clear("syncQueue");
}

export async function appendBackupRecord(rec: LocalBackupRecord): Promise<void> {
  const db = await getLocalDb();
  await db.put("backups", rec);
}

export async function listBackupRecords(): Promise<LocalBackupRecord[]> {
  const db = await getLocalDb();
  if (!db.objectStoreNames.contains("backups")) return [];
  const all = await db.getAll("backups");
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getBackupRecord(id: string): Promise<LocalBackupRecord | null> {
  const db = await getLocalDb();
  if (!db.objectStoreNames.contains("backups")) return null;
  return (await db.get("backups", id)) ?? null;
}

export async function deleteBackupRecord(id: string): Promise<void> {
  const db = await getLocalDb();
  if (!db.objectStoreNames.contains("backups")) return;
  await db.delete("backups", id);
}
