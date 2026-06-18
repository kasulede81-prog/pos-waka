/**
 * Post-restore read-only validation — inventory, debt, suppliers, purchases.
 */

import type { Customer, DebtPayment, Product, Purchase, Sale, StockMovement, Supplier, SupplierPayment } from "../types";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";
import { reconcileSuppliersFromPurchaseHistory } from "./purchaseRecovery";

export type PostRestoreValidationStatus = "healthy" | "warning" | "critical";

export type PostRestoreValidationSnapshot = {
  checkedAt: string;
  inventory: { ok: boolean; mismatchCount: number; status: PostRestoreValidationStatus };
  debt: { ok: boolean; mismatchCount: number; status: PostRestoreValidationStatus };
  suppliers: { ok: boolean; mismatchCount: number; status: PostRestoreValidationStatus };
  purchases: { ok: boolean; voidedCount: number; pendingSyncCount: number; status: PostRestoreValidationStatus };
  overallStatus: PostRestoreValidationStatus;
};

let lastPostRestoreValidation: PostRestoreValidationSnapshot | null = null;

function statusFromCount(count: number, criticalAt: number): PostRestoreValidationStatus {
  if (count === 0) return "healthy";
  if (count >= criticalAt) return "critical";
  return "warning";
}

export function buildPostRestoreValidationSnapshot(input: {
  products: Product[];
  stockMovements: StockMovement[];
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  suppliers: Supplier[];
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
}): PostRestoreValidationSnapshot {
  const inventoryResult = verifyInventoryIntegrity({
    products: input.products,
    movements: input.stockMovements,
  });

  const debtResult = verifyCustomerDebtIntegrity(input.customers, input.sales, input.debtPayments, {
    heal: false,
  });

  const reconciled = reconcileSuppliersFromPurchaseHistory(
    input.suppliers,
    input.purchases,
    input.supplierPayments,
  );
  const reconciledById = new Map(reconciled.map((s) => [s.id, s]));
  let supplierMismatches = 0;
  for (const supplier of input.suppliers) {
    const expected = reconciledById.get(supplier.id);
    if (!expected) continue;
    if (supplier.balanceOwedUgx !== expected.balanceOwedUgx) supplierMismatches += 1;
  }

  const voidedCount = input.purchases.filter((p) => p.voidedAt != null && String(p.voidedAt).length > 0).length;
  const pendingSyncCount = input.purchases.filter((p) => p.pendingSync).length;
  const purchaseStatus: PostRestoreValidationStatus =
    pendingSyncCount > 0 ? "warning" : "healthy";

  const inventoryStatus = statusFromCount(inventoryResult.mismatches.length, 3);
  const debtStatus = statusFromCount(debtResult.mismatches.length, 1);
  const supplierStatus = statusFromCount(supplierMismatches, 1);

  const statuses = [inventoryStatus, debtStatus, supplierStatus, purchaseStatus];
  const overallStatus: PostRestoreValidationStatus = statuses.includes("critical")
    ? "critical"
    : statuses.includes("warning")
      ? "warning"
      : "healthy";

  return {
    checkedAt: new Date().toISOString(),
    inventory: {
      ok: inventoryResult.ok,
      mismatchCount: inventoryResult.mismatches.length,
      status: inventoryStatus,
    },
    debt: {
      ok: debtResult.ok,
      mismatchCount: debtResult.mismatches.length,
      status: debtStatus,
    },
    suppliers: {
      ok: supplierMismatches === 0,
      mismatchCount: supplierMismatches,
      status: supplierStatus,
    },
    purchases: {
      ok: pendingSyncCount === 0,
      voidedCount,
      pendingSyncCount,
      status: purchaseStatus,
    },
    overallStatus,
  };
}

export function runPostRestoreValidationSnapshot(input: {
  products: Product[];
  stockMovements: StockMovement[];
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  suppliers: Supplier[];
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
}): PostRestoreValidationSnapshot {
  const snapshot = buildPostRestoreValidationSnapshot(input);
  lastPostRestoreValidation = snapshot;
  return snapshot;
}

export function getLastPostRestoreValidation(): PostRestoreValidationSnapshot | null {
  return lastPostRestoreValidation;
}
