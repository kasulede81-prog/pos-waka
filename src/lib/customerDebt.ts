/**
 * Recompute expected customer debt from the sales ledger and payment history.
 *
 * Invariant: customer.debtBalanceUgx === expected debt where
 *   expected = sum(remaining sale.debtUgx on completed sales)
 *              − sum(debt payments recorded for the customer)
 *
 * Void/return adjustments are already reflected in sale.debtUgx.
 * Debt payments reduce the customer balance but not sale.debtUgx.
 */

import type { Customer, DebtPayment, Sale } from "../types";
import { isCompletedSale } from "./saleStatus";

export function sumRemainingSaleDebtForCustomer(sales: Sale[], customerId: string): number {
  return sales
    .filter((s) => isCompletedSale(s) && s.customerId === customerId)
    .reduce((sum, s) => sum + Math.max(0, s.debtUgx), 0);
}

export function sumDebtPaymentsForCustomer(debtPayments: DebtPayment[], customerId: string): number {
  return debtPayments
    .filter((p) => p.customerId === customerId)
    .reduce((sum, p) => sum + Math.max(0, p.amountUgx), 0);
}

/** Expected running debt balance for one customer. */
export function computeExpectedCustomerDebt(
  customerId: string,
  sales: Sale[],
  debtPayments: DebtPayment[],
): number {
  const remainingOnSales = sumRemainingSaleDebtForCustomer(sales, customerId);
  const paid = sumDebtPaymentsForCustomer(debtPayments, customerId);
  return Math.max(0, remainingOnSales - paid);
}

export function isCustomerDebtBalanced(
  customer: Customer,
  sales: Sale[],
  debtPayments: DebtPayment[],
): boolean {
  return customer.debtBalanceUgx === computeExpectedCustomerDebt(customer.id, sales, debtPayments);
}

/** Returns customers whose stored balance does not match the ledger. */
export function findCustomerDebtMismatches(
  customers: Customer[],
  sales: Sale[],
  debtPayments: DebtPayment[],
): Array<{ customerId: string; stored: number; expected: number }> {
  const mismatches: Array<{ customerId: string; stored: number; expected: number }> = [];
  for (const c of customers) {
    const expected = computeExpectedCustomerDebt(c.id, sales, debtPayments);
    if (c.debtBalanceUgx !== expected) {
      mismatches.push({ customerId: c.id, stored: c.debtBalanceUgx, expected });
    }
  }
  return mismatches;
}
