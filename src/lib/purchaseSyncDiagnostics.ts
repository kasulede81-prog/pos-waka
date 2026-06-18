/**
 * Post-sync purchase diagnostics — read-only mismatch detection for owner visibility.
 */

import type { Product, Purchase, StockMovement, Supplier, SupplierPayment } from "../types";
import { isPurchaseVoided } from "./purchaseCorrections";
import { findBaseUnitPurchaseWarnings } from "./purchaseLineSync";
import { reconcileSuppliersFromPurchaseHistory } from "./purchaseRecovery";
import { readSyncHealthMeta } from "./syncMeta";

export type PurchaseSyncDiagnosticStatus = "healthy" | "warning" | "critical";

export type PurchaseSyncDiagnosticFilter =
  | "all"
  | "unsynced_voids"
  | "missing_stock"
  | "base_unit"
  | "conflicts";

export type PurchaseSyncIssueRow = {
  purchaseId: string;
  supplierName: string;
  kind: "unsynced_void" | "missing_stock_reversal" | "base_unit_warning" | "supplier_conflict";
  detail: string;
  status: PurchaseSyncDiagnosticStatus;
};

export type PurchaseSyncDiagnosticSnapshot = {
  checkedAt: string;
  lastSyncAt: string | null;
  issueCount: number;
  rows: PurchaseSyncIssueRow[];
  unsyncedVoidCount: number;
  missingStockReversalCount: number;
  baseUnitWarningCount: number;
  supplierConflictCount: number;
};

function supplierConflictStatus(delta: number): PurchaseSyncDiagnosticStatus {
  const abs = Math.abs(delta);
  if (abs === 0) return "healthy";
  if (abs >= 100_000) return "critical";
  return "warning";
}

export function buildPurchaseSyncDiagnosticSnapshot(input: {
  purchases: Purchase[];
  suppliers: Supplier[];
  supplierPayments: SupplierPayment[];
  products: Product[];
  stockMovements: StockMovement[];
}): PurchaseSyncDiagnosticSnapshot {
  const syncMeta = readSyncHealthMeta();
  const rows: PurchaseSyncIssueRow[] = [];

  for (const purchase of input.purchases) {
    if (!isPurchaseVoided(purchase)) continue;
    if (purchase.pendingSync) {
      rows.push({
        purchaseId: purchase.id,
        supplierName: purchase.supplierName,
        kind: "unsynced_void",
        detail: purchase.voidReason ?? "",
        status: "warning",
      });
    }
    if (purchase.preVoidCloudSynced && !purchase.voidStockSyncedAt) {
      rows.push({
        purchaseId: purchase.id,
        supplierName: purchase.supplierName,
        kind: "missing_stock_reversal",
        detail: "",
        status: "critical",
      });
    }
  }

  for (const w of findBaseUnitPurchaseWarnings(input.purchases, input.products)) {
    rows.push({
      purchaseId: w.purchaseId,
      supplierName: w.productName,
      kind: "base_unit_warning",
      detail: w.productId,
      status: "warning",
    });
  }

  const reconciled = reconcileSuppliersFromPurchaseHistory(
    input.suppliers,
    input.purchases,
    input.supplierPayments,
  );
  const reconciledById = new Map(reconciled.map((s) => [s.id, s]));
  for (const supplier of input.suppliers) {
    const expected = reconciledById.get(supplier.id);
    if (!expected) continue;
    const delta = supplier.balanceOwedUgx - expected.balanceOwedUgx;
    if (delta === 0) continue;
    rows.push({
      purchaseId: supplier.id,
      supplierName: supplier.name,
      kind: "supplier_conflict",
      detail: `balance delta ${delta >= 0 ? "+" : ""}${delta}`,
      status: supplierConflictStatus(delta),
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    lastSyncAt: syncMeta.lastSuccessAt,
    issueCount: rows.length,
    rows,
    unsyncedVoidCount: rows.filter((r) => r.kind === "unsynced_void").length,
    missingStockReversalCount: rows.filter((r) => r.kind === "missing_stock_reversal").length,
    baseUnitWarningCount: rows.filter((r) => r.kind === "base_unit_warning").length,
    supplierConflictCount: rows.filter((r) => r.kind === "supplier_conflict").length,
  };
}

export function filterPurchaseSyncRows(
  rows: PurchaseSyncIssueRow[],
  filter: PurchaseSyncDiagnosticFilter,
): PurchaseSyncIssueRow[] {
  switch (filter) {
    case "unsynced_voids":
      return rows.filter((r) => r.kind === "unsynced_void");
    case "missing_stock":
      return rows.filter((r) => r.kind === "missing_stock_reversal");
    case "base_unit":
      return rows.filter((r) => r.kind === "base_unit_warning");
    case "conflicts":
      return rows.filter((r) => r.kind === "supplier_conflict");
    default:
      return rows;
  }
}
