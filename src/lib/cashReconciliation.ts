/**
 * Cash drawer reconciliation — canonical expected cash for owner-facing screens.
 */

import type { CashExpense, DebtPayment, Product, ReturnRecord, Sale, ShiftRecord, SupplierPayment } from "../types";
import type { DateFilterBounds } from "./dateFilters";
import { enumerateDaysInBounds } from "./dateFilters";
import { externalReturnRefundsUgx } from "./canonicalRevenue";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials, revenueSalesOnDay } from "./financialMetrics";

/**
 * Expected physical cash in drawer (Option A — single source of truth).
 * Completed sale headers already reflect linked same-day returns in cashPaidUgx.
 * Only external refunds (cross-day, unlinked, or sale outside day scope) reduce expected cash again.
 */
export function computeExpectedDrawerCashUgx(input: {
  cashFromSalesUgx: number;
  debtCollectedUgx: number;
  expenseUgx: number;
  supplierPaymentsUgx: number;
  externalReturnRefundsUgx: number;
}): number {
  return Math.max(
    0,
    input.cashFromSalesUgx +
      input.debtCollectedUgx -
      input.expenseUgx -
      input.supplierPaymentsUgx -
      input.externalReturnRefundsUgx,
  );
}

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
    .filter((e) => !e.deletedAt && e.paidOn === day && (e.approvalStatus ?? "approved") === "approved")
    .reduce((sum, e) => sum + Math.max(0, e.amountUgx), 0);
}

export function sumSupplierPaymentsOnDay(supplierPayments: SupplierPayment[], day: string): number {
  return supplierPayments
    .filter((p) => dateKeyKampala(p.createdAt) === day)
    .reduce((sum, p) => sum + Math.max(0, p.amountUgx), 0);
}

export function sumCashExpensesInMonth(cashExpenses: CashExpense[], monthKey: string): number {
  return cashExpenses
    .filter((e) => !e.deletedAt && e.paidOn.startsWith(monthKey) && (e.approvalStatus ?? "approved") === "approved")
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
  supplierPaymentsUgx: number;
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
  supplierPayments?: SupplierPayment[];
  day: string;
};

/**
 * Single canonical expected-cash figure (UGX) for a Kampala day.
 * Formula: cash from completed sales + debt payments − expenses − supplier payments − external return refunds.
 */
export function getExpectedCashForDay(input: DrawerCashInput): number {
  return getDrawerCashForDayInput(input).expectedDrawerCashUgx;
}

/** Sum expected drawer cash for each day in bounds using the same per-day formula. */
export function sumExpectedDrawerCashForBounds(
  input: Omit<DrawerCashInput, "day">,
  bounds: DateFilterBounds,
): number {
  return enumerateDaysInBounds(bounds).reduce(
    (sum, day) => sum + getDrawerCashForDayInput({ ...input, day }).expectedDrawerCashUgx,
    0,
  );
}

/**
 * Expected physical cash in drawer for a Kampala day:
 * cash from completed sales + debt payments − expenses − supplier payments − external return refunds.
 */
export function getDrawerCashForDayInput(input: DrawerCashInput): DrawerCashSnapshot {
  const { sales, returns, products, debtPayments, cashExpenses, supplierPayments = [], day } = input;
  const expenseUgx = sumCashExpensesOnDay(cashExpenses, day);
  const supplierPaymentsUgx = sumSupplierPaymentsOnDay(supplierPayments, day);
  return getDrawerCashForDay(sales, returns, products, debtPayments, day, expenseUgx, supplierPaymentsUgx);
}

/** Expected physical cash in drawer for a Kampala day (Option A — linked returns already in sale.cashPaidUgx). */
export function getDrawerCashForDay(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  debtPayments: DebtPayment[],
  day: string,
  expenseUgx = 0,
  supplierPaymentsUgx = 0,
): DrawerCashSnapshot {
  const fin = getCompletedFinancials(sales, returns, products, { day });
  const daySales = revenueSalesOnDay(sales, day);
  const dayReturns = returns.filter((r) => dateKeyKampala(r.createdAt) === day);
  const debtCollectedUgx = sumDebtPaymentsOnDay(debtPayments, day);
  const refundsUgx = sumRefundsOnDay(returns, day);
  const externalRefundsUgx = externalReturnRefundsUgx(daySales, dayReturns);
  const cashFromSalesUgx = fin.cashCollectedUgx;
  const expectedDrawerCashUgx = computeExpectedDrawerCashUgx({
    cashFromSalesUgx,
    debtCollectedUgx,
    expenseUgx,
    supplierPaymentsUgx,
    externalReturnRefundsUgx: externalRefundsUgx,
  });
  return {
    cashFromSalesUgx,
    debtCollectedUgx,
    refundsUgx,
    supplierPaymentsUgx,
    expectedDrawerCashUgx,
    revenueUgx: fin.revenueUgx,
    debtIssuedUgx: fin.debtIssuedUgx,
    expenseUgx,
  };
}
