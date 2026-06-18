import type {
  AuditLogEntry,
  CashExpense,
  CashDrawerAdjustment,
  Customer,
  DayCloseSummary,
  DebtPayment,
  Product,
  Purchase,
  ReturnRecord,
  Sale,
  ShopPreferences,
  StockMovement,
  Supplier,
  SupplierPayment,
  VoidRecord,
} from "../types";
import { getActiveAccountKey } from "./accountScope";
import { getLocalDb, readKv, type PersistedSnapshot, writeKv } from "./localDb";

export const ENTITY_STORE_VERSION = 3;

export type EntityBucket =
  | "product"
  | "customer"
  | "sale"
  | "archivedSale"
  | "debtPayment"
  | "dayClose"
  | "auditLog"
  | "supplier"
  | "purchase"
  | "supplierPayment"
  | "stockMovement"
  | "voidRecord"
  | "returnRecord"
  | "cashExpense"
  | "cashDrawerAdjustment"
  | "archivedAuditLog"
  | "archivedDayClose"
  | "archivedVoidRecord"
  | "archivedReturnRecord";

export type EntityRow = {
  key: string;
  accountKey: string;
  bucket: EntityBucket;
  entityId: string;
  sortKey: string;
  data: unknown;
};

export type EntityManifest = {
  version: typeof ENTITY_STORE_VERSION;
  preferences: ShopPreferences;
  salesOrder: string[];
  archivedSalesOrder: string[];
  tombstones: Record<string, string>;
  updatedAt: string;
};

const MANIFEST_KV_KEY = "entity-manifest";

function accountOrNull(): string | null {
  const acc = getActiveAccountKey();
  if (!acc || acc.startsWith("demo:")) return null;
  return acc;
}

export function entityKey(accountKey: string, bucket: EntityBucket, entityId: string): string {
  return `${accountKey}::${bucket}::${entityId}`;
}

function emptyManifest(preferences: ShopPreferences): EntityManifest {
  return {
    version: ENTITY_STORE_VERSION,
    preferences,
    salesOrder: [],
    archivedSalesOrder: [],
    tombstones: {},
    updatedAt: new Date().toISOString(),
  };
}

export async function readEntityManifest(): Promise<EntityManifest | null> {
  const row = await readKv<EntityManifest>(MANIFEST_KV_KEY);
  if (!row || row.version !== ENTITY_STORE_VERSION) return null;
  return row;
}

export async function writeEntityManifest(manifest: EntityManifest): Promise<void> {
  await writeKv(MANIFEST_KV_KEY, { ...manifest, updatedAt: new Date().toISOString() });
}

export async function ensureEntityManifest(preferences: ShopPreferences): Promise<EntityManifest> {
  const existing = await readEntityManifest();
  if (existing) return existing;
  const manifest = emptyManifest(preferences);
  await writeEntityManifest(manifest);
  return manifest;
}

export async function putEntity(bucket: EntityBucket, entityId: string, data: unknown, sortKey?: string): Promise<void> {
  const acc = accountOrNull();
  if (!acc) return;
  const row: EntityRow = {
    key: entityKey(acc, bucket, entityId),
    accountKey: acc,
    bucket,
    entityId,
    sortKey: sortKey ?? entityId,
    data,
  };
  const db = await getLocalDb();
  await db.put("records", row);
}

export async function putEntitiesBatch(
  bucket: EntityBucket,
  rows: Array<{ id: string; data: unknown; sortKey?: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  const acc = accountOrNull();
  if (!acc) return;
  const db = await getLocalDb();
  const tx = db.transaction("records", "readwrite");
  for (const row of rows) {
    await tx.store.put({
      key: entityKey(acc, bucket, row.id),
      accountKey: acc,
      bucket,
      entityId: row.id,
      sortKey: row.sortKey ?? row.id,
      data: row.data,
    } satisfies EntityRow);
  }
  await tx.done;
}

export async function deleteEntityRecord(bucket: EntityBucket, entityId: string): Promise<void> {
  const acc = accountOrNull();
  if (!acc) return;
  const db = await getLocalDb();
  await db.delete("records", entityKey(acc, bucket, entityId));
}

export async function getEntitiesByBucket<T>(bucket: EntityBucket): Promise<T[]> {
  const acc = accountOrNull();
  if (!acc) return [];
  const db = await getLocalDb();
  const all = await db.getAll("records");
  const out: T[] = [];
  for (const row of all) {
    const r = row as EntityRow;
    if (r.accountKey === acc && r.bucket === bucket && r.data != null) {
      out.push(r.data as T);
    }
  }
  return out;
}

export async function getEntitiesByIds<T>(bucket: EntityBucket, ids: string[]): Promise<T[]> {
  if (ids.length === 0) return [];
  const acc = accountOrNull();
  if (!acc) return [];
  const db = await getLocalDb();
  const out: T[] = [];
  for (const id of ids) {
    const row = (await db.get("records", entityKey(acc, bucket, id))) as EntityRow | undefined;
    if (row?.data != null) out.push(row.data as T);
  }
  return out;
}

export async function addProductTombstone(productId: string): Promise<void> {
  const state = await import("../store/usePosStore").then((m) => m.usePosStore.getState());
  const manifest = (await readEntityManifest()) ?? emptyManifest(state.preferences);
  manifest.tombstones[productId] = new Date().toISOString();
  await writeEntityManifest(manifest);
}

export async function readProductTombstones(): Promise<Record<string, string>> {
  const manifest = await readEntityManifest();
  return manifest?.tombstones ?? {};
}

export async function clearProductTombstone(productId: string): Promise<void> {
  const manifest = await readEntityManifest();
  if (!manifest?.tombstones[productId]) return;
  delete manifest.tombstones[productId];
  await writeEntityManifest(manifest);
}

export async function migrateSnapshotToEntities(snap: PersistedSnapshot): Promise<void> {
  const acc = accountOrNull();
  if (!acc) return;

  const manifest = emptyManifest(snap.preferences);
  manifest.salesOrder = snap.sales.map((s) => s.id);
  manifest.archivedSalesOrder = (snap.archivedSales ?? []).map((s) => s.id);
  await writeEntityManifest(manifest);

  await putEntitiesBatch(
    "product",
    snap.products.map((p) => ({ id: p.id, data: p, sortKey: p.updatedAt })),
  );
  await putEntitiesBatch(
    "customer",
    snap.customers.map((c) => ({ id: c.id, data: c, sortKey: c.createdAt })),
  );
  await putEntitiesBatch(
    "sale",
    snap.sales.map((s) => ({ id: s.id, data: s, sortKey: s.createdAt })),
  );
  await putEntitiesBatch(
    "archivedSale",
    (snap.archivedSales ?? []).map((s) => ({ id: s.id, data: s, sortKey: s.createdAt })),
  );
  await putEntitiesBatch("debtPayment", (snap.debtPayments ?? []).map((d) => ({ id: d.id, data: d, sortKey: d.createdAt })));
  await putEntitiesBatch("dayClose", (snap.dayCloses ?? []).map((d) => ({ id: d.id, data: d, sortKey: d.createdAt })));
  await putEntitiesBatch("auditLog", (snap.auditLogs ?? []).map((a) => ({ id: a.id, data: a, sortKey: a.at })));
  await putEntitiesBatch("supplier", (snap.suppliers ?? []).map((s) => ({ id: s.id, data: s, sortKey: s.createdAt })));
  await putEntitiesBatch("purchase", (snap.purchases ?? []).map((p) => ({ id: p.id, data: p, sortKey: p.createdAt })));
  await putEntitiesBatch(
    "supplierPayment",
    (snap.supplierPayments ?? []).map((p) => ({ id: p.id, data: p, sortKey: p.createdAt })),
  );
  await putEntitiesBatch("stockMovement", (snap.stockMovements ?? []).map((m) => ({ id: m.id, data: m, sortKey: m.at })));
  await putEntitiesBatch("voidRecord", (snap.voidRecords ?? []).map((v) => ({ id: v.id, data: v, sortKey: v.createdAt })));
  await putEntitiesBatch("returnRecord", (snap.returnRecords ?? []).map((r) => ({ id: r.id, data: r, sortKey: r.createdAt })));
  await putEntitiesBatch(
    "cashExpense",
    (snap.cashExpenses ?? []).map((e) => ({ id: e.id, data: e, sortKey: e.createdAt })),
  );
  await putEntitiesBatch(
    "cashDrawerAdjustment",
    (snap.cashDrawerAdjustments ?? []).map((a) => ({ id: a.id, data: a, sortKey: a.occurredAt })),
  );
  await putEntitiesBatch(
    "archivedAuditLog",
    (snap.archivedAuditLogs ?? []).map((a) => ({ id: a.id, data: a, sortKey: a.at })),
  );
  await putEntitiesBatch(
    "archivedDayClose",
    (snap.archivedDayCloses ?? []).map((d) => ({ id: d.id, data: d, sortKey: d.createdAt })),
  );
  await putEntitiesBatch(
    "archivedVoidRecord",
    (snap.archivedVoidRecords ?? []).map((v) => ({ id: v.id, data: v, sortKey: v.createdAt })),
  );
  await putEntitiesBatch(
    "archivedReturnRecord",
    (snap.archivedReturnRecords ?? []).map((r) => ({ id: r.id, data: r, sortKey: r.createdAt })),
  );
}

export async function assembleSnapshotFromEntities(): Promise<PersistedSnapshot | null> {
  const manifest = await readEntityManifest();
  if (!manifest) return null;

  const sales = await getEntitiesByIds<Sale>("sale", manifest.salesOrder);
  const archivedSales = await getEntitiesByIds<Sale>("archivedSale", manifest.archivedSalesOrder);
  const salesById = new Map(sales.map((s) => [s.id, s]));
  const archivedById = new Map(archivedSales.map((s) => [s.id, s]));

  return {
    products: await getEntitiesByBucket<Product>("product"),
    customers: await getEntitiesByBucket<Customer>("customer"),
    sales: manifest.salesOrder.map((id) => salesById.get(id)).filter((s): s is Sale => s != null),
    preferences: manifest.preferences,
    debtPayments: await getEntitiesByBucket<DebtPayment>("debtPayment"),
    dayCloses: await getEntitiesByBucket<DayCloseSummary>("dayClose"),
    auditLogs: await getEntitiesByBucket<AuditLogEntry>("auditLog"),
    suppliers: await getEntitiesByBucket<Supplier>("supplier"),
    purchases: await getEntitiesByBucket<Purchase>("purchase"),
    supplierPayments: await getEntitiesByBucket<SupplierPayment>("supplierPayment"),
    stockMovements: await getEntitiesByBucket<StockMovement>("stockMovement"),
    voidRecords: await getEntitiesByBucket<VoidRecord>("voidRecord"),
    returnRecords: await getEntitiesByBucket<ReturnRecord>("returnRecord"),
    cashExpenses: await getEntitiesByBucket<CashExpense>("cashExpense"),
    cashDrawerAdjustments: await getEntitiesByBucket<CashDrawerAdjustment>("cashDrawerAdjustment"),
    archivedSales: manifest.archivedSalesOrder.map((id) => archivedById.get(id)).filter((s): s is Sale => s != null),
    archivedAuditLogs: await getEntitiesByBucket<AuditLogEntry>("archivedAuditLog"),
    archivedDayCloses: await getEntitiesByBucket<DayCloseSummary>("archivedDayClose"),
    archivedVoidRecords: await getEntitiesByBucket<VoidRecord>("archivedVoidRecord"),
    archivedReturnRecords: await getEntitiesByBucket<ReturnRecord>("archivedReturnRecord"),
    updatedAt: manifest.updatedAt,
  };
}

export async function estimateEntityStoreBytes(): Promise<number> {
  const acc = accountOrNull();
  if (!acc) return 0;
  try {
    const db = await getLocalDb();
    const all = await db.getAll("records");
    let bytes = 0;
    for (const row of all) {
      const r = row as EntityRow;
      if (r.accountKey !== acc) continue;
      bytes += JSON.stringify(r).length;
    }
    const manifest = await readKv<unknown>(MANIFEST_KV_KEY);
    if (manifest) bytes += JSON.stringify(manifest).length;
    return bytes;
  } catch {
    return 0;
  }
}
