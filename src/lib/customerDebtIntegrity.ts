/**
 * Customer debt verification and safe auto-heal from sales ledger + payments.
 */

import type { Customer, DebtPayment, Sale } from "../types";
import {
  computeExpectedCustomerDebt,
  findCustomerDebtMismatches,
} from "./customerDebt";

export type CustomerDebtIntegrityResult = {
  ok: boolean;
  mismatches: Array<{ customerId: string; stored: number; expected: number }>;
  healedCount: number;
  customers: Customer[];
};

/** Reconcile stored balances to ledger; heal when expected is authoritative. */
export function verifyCustomerDebtIntegrity(
  customers: Customer[],
  sales: Sale[],
  debtPayments: DebtPayment[],
  opts?: { heal?: boolean },
): CustomerDebtIntegrityResult {
  const mismatches = findCustomerDebtMismatches(customers, sales, debtPayments);
  if (!opts?.heal || mismatches.length === 0) {
    return { ok: mismatches.length === 0, mismatches, healedCount: 0, customers };
  }

  const expectedById = new Map(mismatches.map((m) => [m.customerId, m.expected]));
  let healedCount = 0;
  const next = customers.map((c) => {
    const expected = expectedById.get(c.id);
    if (expected === undefined) return c;
    if (c.debtBalanceUgx === expected) return c;
    healedCount += 1;
    return { ...c, debtBalanceUgx: Math.max(0, expected), version: c.version + 1 };
  });

  return {
    ok: healedCount === mismatches.length,
    mismatches: mismatches.filter((m) => {
      const c = next.find((x) => x.id === m.customerId);
      return c && c.debtBalanceUgx !== m.expected;
    }),
    healedCount,
    customers: next,
  };
}

export function sumCustomerDebtOutstanding(customers: Customer[]): number {
  return customers.reduce((a, c) => a + Math.max(0, c.debtBalanceUgx), 0);
}

export function sumLedgerDebtOutstanding(customers: Customer[], sales: Sale[], debtPayments: DebtPayment[]): number {
  return customers.reduce(
    (a, c) => a + computeExpectedCustomerDebt(c.id, sales, debtPayments),
    0,
  );
}
