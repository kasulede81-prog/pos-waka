/**
 * Shared System Health diagnostics — compute once, reuse across cards.
 */

import type {
  AuditLogEntry,
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
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import { buildDebtSyncDiagnosticSnapshot } from "./debtSyncDiagnostics";
import {
  buildPostRestoreValidationSnapshot,
  type PostRestoreValidationSnapshot,
} from "./postRestoreValidation";
import { buildQueueSyncDiagnosticSnapshot, type QueueSyncDiagnosticSnapshot } from "./queueSyncDiagnostics";
import { analyzeSnapshotTrim, type SnapshotTrimAnalysis } from "./snapshotTrimDiagnostics";
import { snapshotFromPartial } from "../offline/backupEngine";

export type SharedSystemHealthInput = {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  stockMovements: StockMovement[];
  suppliers: Supplier[];
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
  archivedSales: Sale[];
  preferences: ShopPreferences;
  dayCloses?: DayCloseSummary[];
  auditLogs?: AuditLogEntry[];
  voidRecords?: VoidRecord[];
  returnRecords?: ReturnRecord[];
};

export type SharedSystemHealthSnapshot = {
  loadedAt: string;
  queue: QueueSyncDiagnosticSnapshot;
  debtIntegrity: ReturnType<typeof verifyCustomerDebtIntegrity>;
  debtSync: ReturnType<typeof buildDebtSyncDiagnosticSnapshot>;
  postRestoreValidation: PostRestoreValidationSnapshot;
  snapshotTrim: SnapshotTrimAnalysis;
};

let queueCache: QueueSyncDiagnosticSnapshot | null = null;
let queueCacheAt = 0;
const QUEUE_CACHE_MS = 30_000;

let validationCache: { key: string; snapshot: SharedSystemHealthSnapshot } | null = null;

function fingerprint(input: SharedSystemHealthInput): string {
  return [
    input.products.length,
    input.customers.length,
    input.sales.length,
    input.debtPayments.length,
    input.stockMovements.length,
    input.suppliers.length,
    input.purchases.length,
    input.supplierPayments.length,
    input.archivedSales.length,
    input.sales[0]?.id ?? "",
    input.sales[input.sales.length - 1]?.id ?? "",
  ].join(":");
}

export async function readSharedSyncQueueSnapshot(force = false): Promise<QueueSyncDiagnosticSnapshot> {
  const now = Date.now();
  if (!force && queueCache && now - queueCacheAt < QUEUE_CACHE_MS) {
    return queueCache;
  }
  queueCache = await buildQueueSyncDiagnosticSnapshot();
  queueCacheAt = now;
  return queueCache;
}

export function invalidateSharedSyncQueueCache(): void {
  queueCache = null;
  queueCacheAt = 0;
}

export async function buildSharedSystemHealthSnapshot(
  input: SharedSystemHealthInput,
  opts?: { force?: boolean },
): Promise<SharedSystemHealthSnapshot> {
  const key = fingerprint(input);
  if (!opts?.force && validationCache?.key === key) {
    return validationCache.snapshot;
  }

  const queue = await readSharedSyncQueueSnapshot(opts?.force);
  const debtIntegrity = verifyCustomerDebtIntegrity(input.customers, input.sales, input.debtPayments, { heal: false });
  const debtSync = buildDebtSyncDiagnosticSnapshot({
    customers: input.customers,
    sales: input.sales,
    debtPayments: input.debtPayments,
  });

  const postRestoreValidation = buildPostRestoreValidationSnapshot({
    products: input.products,
    customers: input.customers,
    sales: input.sales,
    debtPayments: input.debtPayments,
    stockMovements: input.stockMovements,
    suppliers: input.suppliers,
    purchases: input.purchases,
    supplierPayments: input.supplierPayments,
  });

  const snap =
    snapshotFromPartial({
      products: input.products,
      customers: input.customers,
      sales: input.sales,
      preferences: input.preferences,
      debtPayments: input.debtPayments,
      suppliers: input.suppliers,
      purchases: input.purchases,
      supplierPayments: input.supplierPayments,
      stockMovements: input.stockMovements,
      archivedSales: input.archivedSales,
    }) ??
    ({
      products: input.products,
      customers: input.customers,
      sales: input.sales,
      preferences: input.preferences,
      debtPayments: input.debtPayments,
      dayCloses: input.dayCloses ?? [],
      updatedAt: new Date().toISOString(),
      archivedSales: input.archivedSales,
    } as const);

  const snapshotTrim = analyzeSnapshotTrim(snap);

  const snapshot: SharedSystemHealthSnapshot = {
    loadedAt: new Date().toISOString(),
    queue,
    debtIntegrity,
    debtSync,
    postRestoreValidation,
    snapshotTrim,
  };

  validationCache = { key, snapshot };
  return snapshot;
}

export function clearSharedSystemHealthCache(): void {
  validationCache = null;
  invalidateSharedSyncQueueCache();
}
