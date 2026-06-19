/**
 * Cash drawer reconciliation — canonical expected cash for owner-facing screens.
 */

import type {
  CashDrawerAdjustment,
  CashDrawerFormulaVersion,
  CashExpense,
  DayDrawerOpen,
  DebtPayment,
  Product,
  ReturnRecord,
  Sale,
  ShiftRecord,
  SupplierPayment,
} from "../types";
import type { DateFilterBounds } from "./dateFilters";
import { enumerateDaysInBounds } from "./dateFilters";
import { externalReturnRefundsUgx } from "./canonicalRevenue";
import {
  adjustmentBreakdownByType,
  computeExpectedDrawerCashV2,
  resolveOpeningFloatUgx,
  sumAdjustmentInflowsExcludingOpening,
  sumAdjustmentOutflows,
  type AdjustmentBreakdownByType,
  type ExpectedDrawerCashV2Input,
} from "./cashDrawerLedger";
import { getCashDrawerSalesInput } from "./cashDrawerSales";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials, revenueSalesOnDay } from "./financialMetrics";

export type { ExpectedDrawerCashV2Input };
export { computeExpectedDrawerCashV2 };

/**
 * @deprecated Use computeExpectedDrawerCashV2 — kept for transitional imports.
 */
export function computeExpectedDrawerCashUgx(input: {
  cashFromSalesUgx: number;
  debtCollectedUgx: number;
  expenseUgx: number;
  supplierPaymentsUgx: number;
  externalReturnRefundsUgx: number;
}): number {
  return computeExpectedDrawerCashV2({
    openingFloatUgx: 0,
    cashSalesUgx: input.cashFromSalesUgx,
    cashDebtCollectionsUgx: input.debtCollectedUgx,
    adjustmentInflowsUgx: 0,
    adjustmentOutflowsUgx: 0,
    cashExpensesUgx: input.expenseUgx,
    cashSupplierPaymentsUgx: input.supplierPaymentsUgx,
    cashRefundsUgx: input.externalReturnRefundsUgx,
  });
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

export function sumCashExpensesInBounds(cashExpenses: CashExpense[], bounds: DateFilterBounds): number {
  return cashExpenses
    .filter(
      (e) =>
        !e.deletedAt &&
        (e.approvalStatus ?? "approved") === "approved" &&
        e.paidOn >= bounds.fromKey &&
        e.paidOn <= bounds.toKey,
    )
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
  /** Physical cash from sales (payment-method aware). */
  cashFromSalesUgx: number;
  cashSalesUgx: number;
  mobileMoneySalesUgx: number;
  cardSalesUgx: number;
  openingFloatUgx: number;
  debtCollectedUgx: number;
  adjustmentInflowsUgx: number;
  adjustmentOutflowsUgx: number;
  adjustmentByType: AdjustmentBreakdownByType;
  refundsUgx: number;
  cashRefundsUgx: number;
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
  cashDrawerAdjustments?: CashDrawerAdjustment[];
  shifts?: ShiftRecord[];
  dayDrawerOpens?: DayDrawerOpen[];
  formulaVersion?: CashDrawerFormulaVersion;
  day: string;
};

/**
 * Single canonical expected-cash figure (UGX) for a Kampala day.
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

export function getDrawerCashForDayInput(input: DrawerCashInput): DrawerCashSnapshot {
  const {
    sales,
    returns,
    products,
    debtPayments,
    cashExpenses,
    cashDrawerAdjustments = [],
    supplierPayments = [],
    shifts = [],
    dayDrawerOpens = [],
    formulaVersion = "v1",
    day,
  } = input;
  const expenseUgx = sumCashExpensesOnDay(cashExpenses, day);
  const supplierPaymentsUgx = sumSupplierPaymentsOnDay(supplierPayments, day);
  return getDrawerCashForDay(
    sales,
    returns,
    products,
    debtPayments,
    day,
    expenseUgx,
    supplierPaymentsUgx,
    cashDrawerAdjustments,
    shifts,
    dayDrawerOpens,
    formulaVersion,
  );
}

/** Expected physical cash in drawer for a Kampala day (V2 ledger). */
export function getDrawerCashForDay(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  debtPayments: DebtPayment[],
  day: string,
  expenseUgx = 0,
  supplierPaymentsUgx = 0,
  cashDrawerAdjustments: CashDrawerAdjustment[] = [],
  shifts: ShiftRecord[] = [],
  dayDrawerOpens: DayDrawerOpen[] = [],
  formulaVersion: CashDrawerFormulaVersion = "v1",
): DrawerCashSnapshot {
  const fin = getCompletedFinancials(sales, returns, products, { day });
  const daySales = revenueSalesOnDay(sales, day);
  const dayReturns = returns.filter((r) => dateKeyKampala(r.createdAt) === day);
  const debtCollectedUgx = sumDebtPaymentsOnDay(debtPayments, day);
  const refundsUgx = sumRefundsOnDay(returns, day);
  const cashRefundsUgx = externalReturnRefundsUgx(daySales, dayReturns);
  const drawerSales = getCashDrawerSalesInput(sales, day);
  const openingFloatUgx = resolveOpeningFloatUgx(day, cashDrawerAdjustments, shifts, {
    dayDrawerOpens,
    formulaVersion,
  });
  const adjustmentInflowsUgx = sumAdjustmentInflowsExcludingOpening(cashDrawerAdjustments, day);
  const adjustmentOutflowsUgx = sumAdjustmentOutflows(cashDrawerAdjustments, day);
  const expectedDrawerCashUgx = computeExpectedDrawerCashV2({
    openingFloatUgx,
    cashSalesUgx: drawerSales.cashSalesUgx,
    cashDebtCollectionsUgx: debtCollectedUgx,
    adjustmentInflowsUgx,
    adjustmentOutflowsUgx,
    cashExpensesUgx: expenseUgx,
    cashSupplierPaymentsUgx: supplierPaymentsUgx,
    cashRefundsUgx,
  });
  return {
    cashFromSalesUgx: drawerSales.cashSalesUgx,
    cashSalesUgx: drawerSales.cashSalesUgx,
    mobileMoneySalesUgx: drawerSales.mobileMoneySalesUgx,
    cardSalesUgx: drawerSales.cardSalesUgx,
    openingFloatUgx,
    debtCollectedUgx,
    adjustmentInflowsUgx,
    adjustmentOutflowsUgx,
    adjustmentByType: adjustmentBreakdownByType(cashDrawerAdjustments, day),
    refundsUgx,
    cashRefundsUgx,
    supplierPaymentsUgx,
    expectedDrawerCashUgx,
    revenueUgx: fin.revenueUgx,
    debtIssuedUgx: fin.debtIssuedUgx,
    expenseUgx,
  };
}
