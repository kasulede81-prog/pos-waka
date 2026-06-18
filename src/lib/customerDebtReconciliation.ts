/**
 * Customer debt ledger reconciliation — compare stored balance vs sales + payments ledger.
 * Void/return debt reductions are already reflected in sale.debtUgx.
 */

import type { Customer, DebtPayment, Sale } from "../types";
import { computeExpectedCustomerDebt } from "./customerDebt";

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
 * Merge customer rows after cloud pull.
 * When ledger is authoritative, balance comes from sales + payments — not last-write-wins.
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
  const rec = reconcileCustomerDebtBalance(base, sales, debtPayments);
  if (rec.healthy) return base;
  return {
    ...base,
    debtBalanceUgx: rec.expected,
    version: Math.max(local.version, remote.version) + 1,
  };
}
