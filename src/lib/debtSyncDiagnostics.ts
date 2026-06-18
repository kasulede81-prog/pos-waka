/**
 * Post-sync debt diagnostics — read-only mismatch detection for owner visibility.
 */

import type { Customer, DebtPayment, Sale } from "../types";
import {
  reconcileAllCustomerDebtBalances,
  type CustomerDebtReconciliation,
} from "./customerDebtReconciliation";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import { evaluateDebtSyncHydration } from "./debtSyncState";
import { readSyncHealthMeta } from "./syncMeta";

export type DebtSyncDiagnosticStatus = "healthy" | "warning" | "critical";

export type DebtSyncCustomerRow = CustomerDebtReconciliation & {
  customerName: string;
  status: DebtSyncDiagnosticStatus;
  lastSyncAt: string | null;
};

export type DebtSyncDiagnosticSnapshot = {
  checkedAt: string;
  lastSyncAt: string | null;
  hydration: ReturnType<typeof evaluateDebtSyncHydration>;
  mismatchCount: number;
  rows: DebtSyncCustomerRow[];
  unsyncedPaymentCount: number;
};

export type DebtSyncDiagnosticFilter = "all" | "mismatched" | "missing_payments" | "unsynced";

let lastSnapshot: DebtSyncDiagnosticSnapshot | null = null;

function rowStatus(rec: CustomerDebtReconciliation): DebtSyncDiagnosticStatus {
  if (rec.healthy) return "healthy";
  const abs = Math.abs(rec.delta);
  if (abs >= 50_000) return "critical";
  return "warning";
}

export function buildDebtSyncDiagnosticSnapshot(input: {
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  pendingDebtPaymentPushCount?: number;
}): DebtSyncDiagnosticSnapshot {
  const hydration = evaluateDebtSyncHydration();
  const syncMeta = readSyncHealthMeta();
  const reconciled = reconcileAllCustomerDebtBalances(input.customers, input.sales, input.debtPayments);
  const customerById = new Map(input.customers.map((c) => [c.id, c]));

  const rows: DebtSyncCustomerRow[] = reconciled.map((rec) => ({
    ...rec,
    customerName: customerById.get(rec.customerId)?.name ?? rec.customerId,
    status: rowStatus(rec),
    lastSyncAt: hydration.lastDebtPaymentsSyncAt ?? syncMeta.lastSuccessAt,
  }));

  const mismatchCount = rows.filter((r) => !r.healthy).length;

  return {
    checkedAt: new Date().toISOString(),
    lastSyncAt: syncMeta.lastSuccessAt,
    hydration,
    mismatchCount,
    rows,
    unsyncedPaymentCount: input.pendingDebtPaymentPushCount ?? 0,
  };
}

export function filterDebtSyncRows(
  rows: DebtSyncCustomerRow[],
  filter: DebtSyncDiagnosticFilter,
  hydration: DebtSyncDiagnosticSnapshot["hydration"],
): DebtSyncCustomerRow[] {
  switch (filter) {
    case "mismatched":
      return rows.filter((r) => !r.healthy);
    case "missing_payments":
      return hydration.paymentsHydrated ? [] : rows;
    case "unsynced":
      return rows.filter((r) => !r.healthy && !hydration.paymentsHydrated);
    default:
      return rows;
  }
}

/** Read-only post-sync validation; records snapshot without modifying balances. */
export function runPostSyncDebtValidation(input: {
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
}): DebtSyncDiagnosticSnapshot {
  verifyCustomerDebtIntegrity(input.customers, input.sales, input.debtPayments, { heal: false });
  const snapshot = buildDebtSyncDiagnosticSnapshot(input);
  lastSnapshot = snapshot;
  return snapshot;
}

export function getLastDebtSyncDiagnosticSnapshot(): DebtSyncDiagnosticSnapshot | null {
  return lastSnapshot;
}
