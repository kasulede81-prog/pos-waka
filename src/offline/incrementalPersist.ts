import type { Sale } from "../types";
import type { PosState } from "../store/usePosStore";
import {
  deleteEntityRecord,
  ensureEntityManifest,
  migrateSnapshotToEntities,
  putEntitiesBatch,
  readEntityManifest,
  writeEntityManifest,
  type EntityBucket,
} from "./entityStore";
import { writeSnapshot, type PersistedSnapshot } from "./localDb";

export type IncrementalPersistResult = {
  mode: "incremental" | "full";
  entityWrites: number;
  bytesWritten: number;
  durationMs: number;
};

function diffById<T extends { id: string }>(prev: T[], next: T[]): { upserts: T[]; removedIds: string[] } {
  const prevMap = new Map(prev.map((x) => [x.id, x]));
  const nextMap = new Map(next.map((x) => [x.id, x]));
  const upserts: T[] = [];
  for (const row of next) {
    const old = prevMap.get(row.id);
    if (old !== row) upserts.push(row);
  }
  const removedIds: string[] = [];
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) removedIds.push(id);
  }
  return { upserts, removedIds };
}

async function persistArrayDelta<T extends { id: string }>(
  bucket: EntityBucket,
  prev: T[],
  next: T[],
  sortKey: (row: T) => string,
  stats: { entityWrites: number; bytesWritten: number },
): Promise<void> {
  const { upserts, removedIds } = diffById(prev, next);
  if (upserts.length === 0 && removedIds.length === 0) return;
  if (upserts.length > 0) {
    await putEntitiesBatch(
      bucket,
      upserts.map((row) => ({ id: row.id, data: row, sortKey: sortKey(row) })),
    );
    stats.entityWrites += upserts.length;
    stats.bytesWritten += upserts.reduce((n, row) => n + JSON.stringify(row).length, 0);
  }
  for (const id of removedIds) {
    await deleteEntityRecord(bucket, id);
    stats.entityWrites += 1;
  }
}

function salesOrderFromArray(sales: Sale[]): string[] {
  return sales.map((s) => s.id);
}

/** Incremental entity writes — normal POS operations. */
export async function flushIncrementalPersist(prev: PosState, next: PosState): Promise<IncrementalPersistResult> {
  const started = performance.now();
  const stats = { entityWrites: 0, bytesWritten: 0 };
  const manifest = await ensureEntityManifest(next.preferences);

  if (prev.preferences !== next.preferences) {
    manifest.preferences = next.preferences;
    stats.bytesWritten += JSON.stringify(next.preferences).length;
  }

  await persistArrayDelta("product", prev.products, next.products, (p) => p.updatedAt, stats);
  await persistArrayDelta("customer", prev.customers, next.customers, (c) => c.createdAt, stats);
  await persistArrayDelta("sale", prev.sales, next.sales, (s) => s.createdAt, stats);
  await persistArrayDelta("archivedSale", prev.archivedSales, next.archivedSales, (s) => s.createdAt, stats);
  await persistArrayDelta("debtPayment", prev.debtPayments, next.debtPayments, (d) => d.createdAt, stats);
  await persistArrayDelta("dayClose", prev.dayCloses, next.dayCloses, (d) => d.createdAt, stats);
  await persistArrayDelta("auditLog", prev.auditLogs, next.auditLogs, (a) => a.at, stats);
  await persistArrayDelta("supplier", prev.suppliers, next.suppliers, (s) => s.createdAt, stats);
  await persistArrayDelta("purchase", prev.purchases, next.purchases, (p) => p.createdAt, stats);
  await persistArrayDelta("supplierPayment", prev.supplierPayments, next.supplierPayments, (p) => p.createdAt, stats);
  await persistArrayDelta("stockMovement", prev.stockMovements, next.stockMovements, (m) => m.at, stats);
  await persistArrayDelta(
    "archivedStockMovement",
    prev.archivedStockMovements ?? [],
    next.archivedStockMovements ?? [],
    (m) => m.at,
    stats,
  );
  await persistArrayDelta("voidRecord", prev.voidRecords, next.voidRecords, (v) => v.createdAt, stats);
  await persistArrayDelta("returnRecord", prev.returnRecords, next.returnRecords, (r) => r.createdAt, stats);
  await persistArrayDelta("cashExpense", prev.cashExpenses, next.cashExpenses, (e) => e.createdAt, stats);
  await persistArrayDelta(
    "cashDrawerAdjustment",
    prev.cashDrawerAdjustments,
    next.cashDrawerAdjustments,
    (a) => a.occurredAt,
    stats,
  );
  await persistArrayDelta(
    "dayDrawerOpen",
    prev.dayDrawerOpens,
    next.dayDrawerOpens,
    (d) => d.countedAt,
    stats,
  );
  await persistArrayDelta(
    "inventoryCountSession",
    prev.inventoryCountSessions,
    next.inventoryCountSessions,
    (s) => s.updatedAt,
    stats,
  );
  await persistArrayDelta(
    "archivedAuditLog",
    prev.archivedAuditLogs,
    next.archivedAuditLogs,
    (a) => a.at,
    stats,
  );
  await persistArrayDelta(
    "archivedDayClose",
    prev.archivedDayCloses,
    next.archivedDayCloses,
    (d) => d.createdAt,
    stats,
  );
  await persistArrayDelta(
    "archivedVoidRecord",
    prev.archivedVoidRecords,
    next.archivedVoidRecords,
    (v) => v.createdAt,
    stats,
  );
  await persistArrayDelta(
    "archivedReturnRecord",
    prev.archivedReturnRecords,
    next.archivedReturnRecords,
    (r) => r.createdAt,
    stats,
  );
  await persistArrayDelta(
    "pharmacyPrescription",
    prev.pharmacyPrescriptions ?? [],
    next.pharmacyPrescriptions ?? [],
    (r) => r.updatedAt,
    stats,
  );
  await persistArrayDelta(
    "pharmacyDoctor",
    prev.pharmacyDoctors ?? [],
    next.pharmacyDoctors ?? [],
    (d) => d.updatedAt,
    stats,
  );
  await persistArrayDelta(
    "pharmacyControlledRegister",
    prev.pharmacyControlledRegister ?? [],
    next.pharmacyControlledRegister ?? [],
    (e) => e.at,
    stats,
  );

  if (prev.sales !== next.sales) {
    manifest.salesOrder = salesOrderFromArray(next.sales);
  }
  if (prev.archivedSales !== next.archivedSales) {
    manifest.archivedSalesOrder = salesOrderFromArray(next.archivedSales);
  }

  await writeEntityManifest(manifest);

  return {
    mode: "incremental",
    entityWrites: stats.entityWrites,
    bytesWritten: stats.bytesWritten,
    durationMs: Math.round(performance.now() - started),
  };
}

/** Full snapshot for backups, disaster recovery, export, and legacy compatibility. */
export async function flushFullSnapshotPersist(
  state: PosState,
  opts?: { skipLastGood?: boolean; skipEntityMigration?: boolean },
): Promise<IncrementalPersistResult> {
  const started = performance.now();
  const { readEntityManifest } = await import("./entityStore");
  const { snapshotFieldsFromTombstones, tombstonesFromManifest } = await import("../lib/tombstoneDurability");
  const manifest = await readEntityManifest();
  const tombstoneFields = manifest ? snapshotFieldsFromTombstones(tombstonesFromManifest(manifest)) : { deletedProductIds: [], voidedSaleIds: [] };

  const payload: Omit<PersistedSnapshot, "updatedAt"> = {
    products: state.products,
    customers: state.customers,
    sales: state.sales,
    preferences: state.preferences,
    debtPayments: state.debtPayments,
    dayCloses: state.dayCloses,
    auditLogs: state.auditLogs,
    suppliers: state.suppliers,
    purchases: state.purchases,
    supplierPayments: state.supplierPayments,
    stockMovements: state.stockMovements,
    archivedStockMovements: state.archivedStockMovements ?? [],
    voidRecords: state.voidRecords,
    returnRecords: state.returnRecords,
    cashExpenses: state.cashExpenses,
    cashDrawerAdjustments: state.cashDrawerAdjustments,
    dayDrawerOpens: state.dayDrawerOpens,
    inventoryCountSessions: state.inventoryCountSessions,
    archivedSales: state.archivedSales,
    archivedAuditLogs: state.archivedAuditLogs,
    archivedDayCloses: state.archivedDayCloses,
    archivedVoidRecords: state.archivedVoidRecords,
    archivedReturnRecords: state.archivedReturnRecords,
    pharmacyPrescriptions: state.pharmacyPrescriptions ?? [],
    pharmacyDoctors: state.pharmacyDoctors ?? [],
    pharmacyControlledRegister: state.pharmacyControlledRegister ?? [],
    deletedProductIds: tombstoneFields.deletedProductIds,
    voidedSaleIds: tombstoneFields.voidedSaleIds,
  };
  if (!opts?.skipEntityMigration) {
    await migrateSnapshotToEntities({ ...payload, updatedAt: new Date().toISOString() });
  }
  await writeSnapshot(payload, { skipLastGood: opts?.skipLastGood });
  const bytesWritten = JSON.stringify(payload).length;
  return {
    mode: "full",
    entityWrites: state.products.length + state.customers.length + state.sales.length,
    bytesWritten,
    durationMs: Math.round(performance.now() - started),
  };
}

export async function markProductDeleted(productId: string): Promise<void> {
  await deleteEntityRecord("product", productId);
  const manifest = await readEntityManifest();
  if (!manifest) return;
  manifest.tombstones[productId] = new Date().toISOString();
  await writeEntityManifest(manifest);
}

export async function markSupplierDeleted(supplierId: string): Promise<void> {
  await deleteEntityRecord("supplier", supplierId);
  const manifest = await readEntityManifest();
  if (!manifest) return;
  manifest.tombstones[supplierId] = new Date().toISOString();
  await writeEntityManifest(manifest);
}
