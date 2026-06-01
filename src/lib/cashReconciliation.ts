/**
 * Cash drawer reconciliation — sales cash + debt repayments − expenses.
 */

import type { DebtPayment, Product, ReturnRecord, Sale, ShiftRecord } from "../types";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials } from "./financialMetrics";

export function sumDebtPaymentsOnDay(debtPayments: DebtPayment[], day: string): number {
  return debtPayments
    .filter((p) => dateKeyKampala(p.createdAt) === day)
    .reduce((sum, p) => sum + Math.max(0, p.amountUgx), 0);
}

export function sumDebtPaymentsDuringShift(debtPayments: DebtPayment[], shift: ShiftRecord): number {
  const startMs = new Date(shift.startAt).getTime();
  const endMs = shift.endAt ? new Date(shift.endAt).getTime() : Date.now();
  if (Number.isNaN(startMs)) return 0;
  return debtPayments
    .filter((p) => {
      const t = new Date(p.createdAt).getTime();
      return !Number.isNaN(t) && t >= startMs && t <= endMs;
    })
    .reduce((sum, p) => sum + Math.max(0, p.amountUgx), 0);
}

export type DrawerCashSnapshot = {
  cashFromSalesUgx: number;
  debtCollectedUgx: number;
  expectedDrawerCashUgx: number;
  revenueUgx: number;
  debtIssuedUgx: number;
  expenseUgx: number;
};

/** Expected physical cash in drawer for a Kampala day (completed sales + debt payments − expenses). */
export function getDrawerCashForDay(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  debtPayments: DebtPayment[],
  day: string,
  expenseUgx = 0,
): DrawerCashSnapshot {
  const fin = getCompletedFinancials(sales, returns, products, { day });
  const debtCollectedUgx = sumDebtPaymentsOnDay(debtPayments, day);
  const cashFromSalesUgx = fin.cashCollectedUgx;
  const expectedDrawerCashUgx = Math.max(0, cashFromSalesUgx + debtCollectedUgx - expenseUgx);
  return {
    cashFromSalesUgx,
    debtCollectedUgx,
    expectedDrawerCashUgx,
    revenueUgx: fin.revenueUgx,
    debtIssuedUgx: fin.debtIssuedUgx,
    expenseUgx,
  };
}
