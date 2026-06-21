/**
 * Cloud recovery validation — PART 3 & PART 7 simulation checks.
 */

import type {
  CashDrawerAdjustment,
  CashExpense,
  Customer,
  DayDrawerOpen,
  DebtPayment,
  InventoryCountSession,
  Product,
  Purchase,
  Sale,
  ShopPreferences,
  StockMovement,
  Supplier,
  SupplierPayment,
} from "../types";
import { usePosStore } from "../store/usePosStore";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";
import { inventoryValueAtCostUgx } from "./costPrecision";
import { buildCloudRecoverySnapshotFromStore } from "./cloudAuthorityAudit";
import { buildPostRestoreValidationSnapshot } from "./postRestoreValidation";
import { getCompletedFinancials } from "./financialMetrics";

export type CloudRecoveryValidationFailure = {
  code: string;
  message: string;
  severity: "warning" | "critical";
};

export type CloudRecoveryValidationResult = {
  checkedAt: string;
  ok: boolean;
  failures: CloudRecoveryValidationFailure[];
  counts: {
    products: number;
    sales: number;
    customers: number;
    suppliers: number;
    purchases: number;
    shifts: number;
    dayCloses: number;
    returns: number;
    debtPayments: number;
    expenses: number;
    supplierPayments: number;
    cashAdjustments: number;
    dayOpens: number;
    inventoryCounts: number;
    stockMovements: number;
    staff: number;
    auditLogs: number;
  };
  financial: {
    revenueUgx: number;
    profitUgx: number;
  };
  inventoryValueUgx: number;
  debtMismatches: number;
  recoveryScorePct: number;
};

export function validateCloudRecoveryLocalState(
  input: {
    products: Product[];
    customers: Customer[];
    sales: Sale[];
    debtPayments: DebtPayment[];
    stockMovements: StockMovement[];
    suppliers: Supplier[];
    purchases: Purchase[];
    supplierPayments: SupplierPayment[];
    preferences: ShopPreferences;
    returnRecords: { refundAmountUgx: number }[];
    dayClosesCount: number;
    cashExpenses?: CashExpense[];
    cashDrawerAdjustments?: CashDrawerAdjustment[];
    dayDrawerOpens?: DayDrawerOpen[];
    inventoryCountSessions?: InventoryCountSession[];
    auditLogsCount?: number;
  },
  opts?: { recoveryMode?: boolean },
): CloudRecoveryValidationResult {
  const failures: CloudRecoveryValidationFailure[] = [];
  const shifts = input.preferences.shifts ?? [];

  const inventory = verifyInventoryIntegrity({
    products: input.products,
    movements: input.stockMovements,
  });
  if (!inventory.ok) {
    failures.push({
      code: "inventory_integrity",
      message: `Inventory integrity: ${inventory.mismatches.length} mismatch(es)`,
      severity: opts?.recoveryMode || inventory.mismatches.length >= 3 ? "critical" : "warning",
    });
  }

  const debt = verifyCustomerDebtIntegrity(input.customers, input.sales, input.debtPayments, { heal: false });
  if (!debt.ok) {
    failures.push({
      code: "debt_integrity",
      message: `Debt integrity: ${debt.mismatches.length} mismatch(es)`,
      severity: "critical",
    });
  }

  const postRestore = buildPostRestoreValidationSnapshot({
    products: input.products,
    stockMovements: input.stockMovements,
    customers: input.customers,
    sales: input.sales,
    debtPayments: input.debtPayments,
    suppliers: input.suppliers,
    purchases: input.purchases,
    supplierPayments: input.supplierPayments,
  });
  if (postRestore.overallStatus === "critical") {
    failures.push({
      code: "post_restore_critical",
      message: "Post-restore validation critical",
      severity: "critical",
    });
  } else if (postRestore.overallStatus === "warning") {
    failures.push({
      code: "post_restore_warning",
      message: "Post-restore validation warning",
      severity: "warning",
    });
  }

  const unsyncedPurchases = input.purchases.filter((p) => p.pendingSync).length;
  if (unsyncedPurchases > 0) {
    failures.push({
      code: "unsynced_purchases",
      message: `${unsyncedPurchases} purchase(s) pending cloud sync`,
      severity: opts?.recoveryMode ? "critical" : unsyncedPurchases > 5 ? "critical" : "warning",
    });
  }

  const unsyncedSales = input.sales.filter((s) => s.pendingSync).length;
  if (unsyncedSales > 0 && opts?.recoveryMode) {
    failures.push({
      code: "unsynced_sales",
      message: `${unsyncedSales} sale(s) pending cloud sync`,
      severity: "critical",
    });
  } else if (unsyncedSales > 10) {
    failures.push({
      code: "unsynced_sales",
      message: `${unsyncedSales} sale(s) pending cloud sync`,
      severity: "critical",
    });
  }

  if (!opts?.recoveryMode) {
    const cloudSnap = buildCloudRecoverySnapshotFromStore();
    if (!cloudSnap.bootstrapComplete) {
      failures.push({
        code: "bootstrap_incomplete",
        message: "Cloud bootstrap pull not complete on this device",
        severity: "warning",
      });
    }
    if (cloudSnap.scorePct < 90) {
      failures.push({
        code: "low_recovery_score",
        message: `Recovery score ${cloudSnap.scorePct}% below production threshold`,
        severity: "warning",
      });
    }
  }

  const fin = getCompletedFinancials(input.sales, input.returnRecords as never, input.products);
  const staffAccounts = input.preferences.staffAccounts ?? [];

  return {
    checkedAt: new Date().toISOString(),
    ok: failures.filter((f) => f.severity === "critical").length === 0,
    failures,
    counts: {
      products: input.products.length,
      sales: input.sales.length,
      customers: input.customers.length,
      suppliers: input.suppliers.length,
      purchases: input.purchases.length,
      shifts: shifts.length,
      dayCloses: input.dayClosesCount,
      returns: input.returnRecords.length,
      debtPayments: input.debtPayments.length,
      expenses: input.cashExpenses?.length ?? 0,
      supplierPayments: input.supplierPayments.length,
      cashAdjustments: input.cashDrawerAdjustments?.length ?? 0,
      dayOpens: input.dayDrawerOpens?.length ?? 0,
      inventoryCounts: input.inventoryCountSessions?.length ?? 0,
      stockMovements: input.stockMovements.length,
      staff: staffAccounts.length,
      auditLogs: input.auditLogsCount ?? 0,
    },
    financial: { revenueUgx: fin.revenueUgx, profitUgx: fin.profitUgx },
    inventoryValueUgx: inventoryValueAtCostUgx(input.products),
    debtMismatches: debt.mismatches.length,
    recoveryScorePct: opts?.recoveryMode ? 100 : buildCloudRecoverySnapshotFromStore().scorePct,
  };
}

/** PART 7 — lightweight simulation report (no destructive wipe). */
export function buildCloudRecoverySimulationReport(opts?: { recoveryMode?: boolean }): CloudRecoveryValidationResult {
  const s = usePosStore.getState();
  return validateCloudRecoveryLocalState(
    {
      products: s.products,
      customers: s.customers,
      sales: s.sales,
      debtPayments: s.debtPayments,
      stockMovements: s.stockMovements,
      suppliers: s.suppliers,
      purchases: s.purchases,
      supplierPayments: s.supplierPayments,
      preferences: s.preferences,
      returnRecords: s.returnRecords,
      dayClosesCount: s.dayCloses.length,
      cashExpenses: s.cashExpenses,
      cashDrawerAdjustments: s.cashDrawerAdjustments,
      dayDrawerOpens: s.dayDrawerOpens,
      inventoryCountSessions: s.inventoryCountSessions,
      auditLogsCount: s.auditLogs.length + s.archivedAuditLogs.length,
    },
    { recoveryMode: opts?.recoveryMode },
  );
}

let lastCloudRecoveryValidation: CloudRecoveryValidationResult | null = null;

export function recordCloudRecoveryValidation(result: CloudRecoveryValidationResult): void {
  lastCloudRecoveryValidation = result;
}

export function getLastCloudRecoveryValidation(): CloudRecoveryValidationResult | null {
  return lastCloudRecoveryValidation;
}
