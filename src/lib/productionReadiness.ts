import type { AuditLogEntry, Customer, DebtPayment, Product, Sale, StockMovement, SyncOperation } from "../types";
import { getAuditSyncHealth } from "./auditHealth";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import { fetchProductionMigrationHealth, type MigrationHealthReport } from "./migrationHealth";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";

export type ReadinessStatus = "pass" | "warning" | "fail";

export type ReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
};

export type ReleaseChecklistItem = {
  id: string;
  required: boolean;
  passed: boolean;
  detail: string;
};

export type ProductionReadinessReport = {
  overall: ReadinessStatus;
  certificationState: "PASS" | "WARNING" | "FAIL";
  checks: ReadinessCheck[];
  releaseChecklist: ReleaseChecklistItem[];
  migrationReport?: MigrationHealthReport;
};

function worstStatus(statuses: ReadinessStatus[]): ReadinessStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warning")) return "warning";
  return "pass";
}

export function evaluateDebtIntegrityStatus(
  customers: Customer[],
  sales: Sale[],
  debtPayments: DebtPayment[],
): ReadinessCheck {
  const result = verifyCustomerDebtIntegrity(customers, sales, debtPayments, { heal: false });
  if (result.ok) {
    return { id: "debt_integrity", label: "Customer debt", status: "pass", detail: "Balances match ledger" };
  }
  return {
    id: "debt_integrity",
    label: "Customer debt",
    status: "fail",
    detail: `${result.mismatches.length} mismatch(es)`,
  };
}

export function evaluateInventoryIntegrityStatus(input: {
  products: Product[];
  stockMovements: StockMovement[];
  archivedStockMovements?: StockMovement[];
}): ReadinessCheck {
  const { ok, mismatches } = verifyInventoryIntegrity({
    products: input.products,
    movements: input.stockMovements,
    archivedMovements: input.archivedStockMovements,
  });
  if (ok) {
    return { id: "inventory_integrity", label: "Inventory", status: "pass", detail: "Stock matches movements" };
  }
  return {
    id: "inventory_integrity",
    label: "Inventory",
    status: "fail",
    detail: `${mismatches.length} mismatch(es)`,
  };
}

export function evaluateSyncQueueStatus(queue: SyncOperation[]): ReadinessCheck {
  const pending = queue.length;
  if (pending === 0) {
    return { id: "sync_queue", label: "Sync queue", status: "pass", detail: "Empty" };
  }
  return {
    id: "sync_queue",
    label: "Sync queue",
    status: pending > 50 ? "warning" : "pass",
    detail: `${pending} pending`,
  };
}

export function evaluateAuditSyncStatus(queue: SyncOperation[]): ReadinessCheck {
  const { pendingAuditOps } = getAuditSyncHealth(queue);
  if (pendingAuditOps === 0) {
    return { id: "audit_sync", label: "Audit sync", status: "pass", detail: "Operational" };
  }
  return {
    id: "audit_sync",
    label: "Audit sync",
    status: "fail",
    detail: `${pendingAuditOps} audit op(s) queued`,
  };
}

export function migrationChecksFromReport(report: MigrationHealthReport): ReadinessCheck[] {
  return report.checks.map((c) => ({
    id: c.id,
    label: c.id,
    status: report.offline ? "fail" : c.pass ? "pass" : "fail",
    detail: c.detail,
  }));
}

export async function runProductionReadinessSelfTest(input: {
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  products: Product[];
  stockMovements: StockMovement[];
  auditLogs: AuditLogEntry[];
  syncQueue: SyncOperation[];
}): Promise<ProductionReadinessReport> {
  const migrationReport = await fetchProductionMigrationHealth();
  const migrationChecks = migrationChecksFromReport(migrationReport);
  const auditCheck = evaluateAuditSyncStatus(input.syncQueue);
  const debtCheck = evaluateDebtIntegrityStatus(input.customers, input.sales, input.debtPayments);
  const inventoryCheck = evaluateInventoryIntegrityStatus({
    products: input.products,
    stockMovements: input.stockMovements,
  });
  const syncQueueCheck = evaluateSyncQueueStatus(input.syncQueue);
  const checks: ReadinessCheck[] = [...migrationChecks, auditCheck, debtCheck, inventoryCheck, syncQueueCheck];

  const requiredMigrationPass = migrationChecks.every((c) => c.status === "pass");
  const requiredItems: ReleaseChecklistItem[] = [
    {
      id: "required_migrations_082_087",
      required: true,
      passed: requiredMigrationPass,
      detail: requiredMigrationPass ? "All required migrations present" : "Missing one or more required migrations",
    },
    {
      id: "integrity_self_test",
      required: true,
      passed: debtCheck.status === "pass",
      detail: debtCheck.detail,
    },
    {
      id: "audit_sync_available",
      required: true,
      passed: auditCheck.status === "pass",
      detail: auditCheck.detail,
    },
    {
      id: "inventory_verification",
      required: true,
      passed: inventoryCheck.status === "pass",
      detail: inventoryCheck.detail,
    },
  ];
  const hasRequiredFailure = requiredItems.some((item) => !item.passed);
  const computedOverall = hasRequiredFailure ? "fail" : worstStatus(checks.map((c) => c.status));
  const certificationState: "PASS" | "WARNING" | "FAIL" =
    computedOverall === "pass" ? "PASS" : computedOverall === "warning" ? "WARNING" : "FAIL";

  return {
    overall: computedOverall,
    certificationState,
    checks,
    releaseChecklist: requiredItems,
    migrationReport,
  };
}
