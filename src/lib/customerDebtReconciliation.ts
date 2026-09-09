/**
 * Customer debt ledger reconciliation — compare stored balance vs sales + payments ledger.
 * Void/return debt reductions are already reflected in sale.debtUgx.
 */

import type { Customer, DebtPayment, Sale } from "../types";
import {
  computeExpectedCustomerDebt,
  sumDebtPaymentsForCustomer,
  sumRemainingSaleDebtForCustomer,
} from "./customerDebt";

export type CustomerDebtReconciliation = {
  customerId: string;
  expected: number;
  actual: number;
  delta: number;
  healthy: boolean;
};

export function reconcileCustomerDebtBalance(
  customer: Customer,
  sales: Sale[],
  debtPayments: DebtPayment[],
): CustomerDebtReconciliation {
  const expected = computeExpectedCustomerDebt(customer.id, sales, debtPayments);
  const actual = Math.max(0, customer.debtBalanceUgx);
  return {
    customerId: customer.id,
    expected,
    actual,
    delta: actual - expected,
    healthy: actual === expected,
  };
}

export function reconcileAllCustomerDebtBalances(
  customers: Customer[],
  sales: Sale[],
  debtPayments: DebtPayment[],
): CustomerDebtReconciliation[] {
  return customers.map((c) => reconcileCustomerDebtBalance(c, sales, debtPayments));
}

type Versioned = { updatedAt?: string; createdAt?: string; version?: number };

function newerCustomerRow<T extends Versioned>(a: T, b: T): T {
  const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
  const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
  if (ta !== tb) return ta >= tb ? a : b;
  return (a.version ?? 0) >= (b.version ?? 0) ? a : b;
}

/**
 * True only when the in-memory sales + payments can stand in for this
 * customer's full debt history. An incomplete subset must not replace the
 * cloud `debtBalanceUgx` (R1).
 */
export function isLocalCustomerDebtLedgerComplete(
  customerId: string,
  remoteBalanceUgx: number,
  sales: Sale[],
  debtPayments: DebtPayment[],
): boolean {
  const saleDebt = sumRemainingSaleDebtForCustomer(sales, customerId);
  const paid = sumDebtPaymentsForCustomer(debtPayments, customerId);
  const expected = Math.max(0, saleDebt - paid);
  const remote = Math.max(0, remoteBalanceUgx);

  if (expected === remote) return true;
  if (saleDebt === 0 && paid === 0) return false;
  // Missing payments: local expected is higher than the cloud balance.
  if (expected > remote) return false;
  // Missing sales: local expected is lower and no payments explain the gap.
  if (expected < remote && paid === 0) return false;
  // Ledger does not cover the cloud-reported outstanding amount.
  if (saleDebt + paid < remote) return false;
  return true;
}

/**
 * Merge customer rows after cloud pull.
 * Ledger overwrite runs only when the caller asked for it AND the local
 * sales + payments are complete enough for this customer.
 */
export function mergeCustomerFromCloudPull(
  local: Customer,
  remote: Customer,
  sales: Sale[],
  debtPayments: DebtPayment[],
  opts?: { ledgerAuthoritative?: boolean },
): Customer {
  const base = newerCustomerRow(local, remote);
  if (!opts?.ledgerAuthoritative) return base;
  if (!isLocalCustomerDebtLedgerComplete(local.id, remote.debtBalanceUgx, sales, debtPayments)) {
    return base;
  }
  const rec = reconcileCustomerDebtBalance(base, sales, debtPayments);
  if (rec.healthy) return base;
  const nextVersion =
    local.debtBalanceUgx === rec.expected
      ? Math.max(local.version, remote.version)
      : Math.max(local.version, remote.version) + 1;
  return {
    ...base,
    debtBalanceUgx: rec.expected,
    version: nextVersion,
  };
}
