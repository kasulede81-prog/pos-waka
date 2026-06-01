/**
 * Cash drawer reconciliation — canonical expected cash for owner-facing screens.
 */

import type { CashExpense, DebtPayment, Product, ReturnRecord, Sale, ShiftRecord } from "../types";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials } from "./financialMetrics";

export function sumDebtPaymentsOnDay(debtPayments: DebtPayment[], day: string): number {
  return debtPayments
    .filter((p) => dateKeyKampala(p.createdAt) === day)
    .reduce((sum, p) => sum + Math.max(0, p.amountUgx), 0);
}

export function sumRefundsOnDay(returns: ReturnRecord[], day: string): number {
  return returns
    .filter((r) => dateKeyKampala(r.createdAt) === day)
    .reduce((sum, r) => sum + Math.max(0, r.refundAmountUgx), 0);
}

export function sumCashExpensesOnDay(cashExpenses: CashExpense[], day: string): number {
  return cashExpenses
    .filter((e) => !e.deletedAt && e.paidOn === day)
    .reduce((sum, e) => sum + Math.max(0, e.amountUgx), 0);
}

export function sumCashExpensesInMonth(cashExpenses: CashExpense[], monthKey: string): number {
  return cashExpenses
    .filter((e) => !e.deletedAt && e.paidOn.startsWith(monthKey))
    .reduce((sum, e) => sum + Math.max(0, e.amountUgx), 0);
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
  refundsUgx: number;
  expectedDrawerCashUgx: number;
  revenueUgx: number;
  debtIssuedUgx: number;
  expenseUgx: number;
};

export type DrawerCashInput = {
  sales: Sale[];
  returns: ReturnRecord[];
  products: Product[];
  debtPayments: DebtPayment[];
  cashExpenses: CashExpense[];
  day: string;
};

/**
 * Single canonical expected-cash figure (UGX) for a Kampala day.
 * Formula: cash from completed sales + debt payments collected − cash expenses − refunds.
 */
export function getExpectedCashForDay(input: DrawerCashInput): number {
  return getDrawerCashForDayInput(input).expectedDrawerCashUgx;
}

/**
 * Expected physical cash in drawer for a Kampala day:
 * cash from completed sales + debt payments − cash expenses − refund payouts.
 */
export function getDrawerCashForDayInput(input: DrawerCashInput): DrawerCashSnapshot {
  const { sales, returns, products, debtPayments, cashExpenses, day } = input;
  const expenseUgx = sumCashExpensesOnDay(cashExpenses, day);
  return getDrawerCashForDay(sales, returns, products, debtPayments, day, expenseUgx);
}

/** Expected physical cash in drawer for a Kampala day (completed sales + debt payments − expenses − refunds). */
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
  const refundsUgx = sumRefundsOnDay(returns, day);
  const cashFromSalesUgx = fin.cashCollectedUgx;
  const expectedDrawerCashUgx = Math.max(0, cashFromSalesUgx + debtCollectedUgx - expenseUgx - refundsUgx);
  return {
    cashFromSalesUgx,
    debtCollectedUgx,
    refundsUgx,
    expectedDrawerCashUgx,
    revenueUgx: fin.revenueUgx,
    debtIssuedUgx: fin.debtIssuedUgx,
    expenseUgx,
  };
}
