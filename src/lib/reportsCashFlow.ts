/**
 * Reports Cash Flow — period physical cash movement.
 *
 * Consumes the existing drawer snapshot (getDrawerCashForDayInput) and closed-day
 * frozen totals. Does not reimplement tender/refund/expense/supplier classifiers.
 * Opening cash is a starting balance, not a period inflow.
 */

import type {
  CashDrawerAdjustment,
  CashDrawerFormulaVersion,
  CashExpense,
  DayCloseSummary,
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
import { resolveReportAuthority, type ClosedDayAuthoritativeTotals } from "./closedDayAuthority";
import { getDrawerCashForDayInput, type DrawerCashSnapshot } from "./cashReconciliation";

export type ReportsPeriodCashFlow = {
  cashInUgx: number;
  cashOutUgx: number;
  netUgx: number;
  unavailable: boolean;
};

const UNAVAILABLE: ReportsPeriodCashFlow = {
  cashInUgx: 0,
  cashOutUgx: 0,
  netUgx: 0,
  unavailable: true,
};

export function periodCashFlowFromComponents(input: {
  cashSalesUgx: number;
  debtCollectedUgx: number;
  adjustmentInflowsUgx: number;
  expenseUgx: number;
  supplierPaymentsUgx: number;
  cashRefundsUgx: number;
  adjustmentOutflowsUgx: number;
}): { cashInUgx: number; cashOutUgx: number; netUgx: number } {
  const cashInUgx =
    Math.max(0, input.cashSalesUgx) +
    Math.max(0, input.debtCollectedUgx) +
    Math.max(0, input.adjustmentInflowsUgx);
  const cashOutUgx =
    Math.max(0, input.expenseUgx) +
    Math.max(0, input.supplierPaymentsUgx) +
    Math.max(0, input.cashRefundsUgx) +
    Math.max(0, input.adjustmentOutflowsUgx);
  return { cashInUgx, cashOutUgx, netUgx: cashInUgx - cashOutUgx };
}

export function periodCashFlowFromDrawer(drawer: DrawerCashSnapshot): {
  cashInUgx: number;
  cashOutUgx: number;
  netUgx: number;
} {
  return periodCashFlowFromComponents({
    cashSalesUgx: drawer.cashSalesUgx,
    debtCollectedUgx: drawer.debtCollectedUgx,
    adjustmentInflowsUgx: drawer.adjustmentInflowsUgx,
    expenseUgx: drawer.expenseUgx,
    supplierPaymentsUgx: drawer.supplierPaymentsUgx,
    cashRefundsUgx: drawer.cashRefundsUgx,
    adjustmentOutflowsUgx: drawer.adjustmentOutflowsUgx,
  });
}

export function periodCashFlowFromFrozenTotals(
  tot: ClosedDayAuthoritativeTotals,
): { cashInUgx: number; cashOutUgx: number; netUgx: number } | null {
  const cashSalesUgx = tot.cashSalesUgx ?? tot.cashFromSalesUgx;
  if (
    cashSalesUgx == null ||
    tot.debtCollectedUgx == null ||
    tot.expenseUgx == null ||
    tot.supplierPaymentsUgx == null ||
    tot.adjustmentInflowsUgx == null ||
    tot.adjustmentOutflowsUgx == null ||
    tot.cashRefundsUgx == null
  ) {
    return null;
  }
  return periodCashFlowFromComponents({
    cashSalesUgx,
    debtCollectedUgx: tot.debtCollectedUgx,
    adjustmentInflowsUgx: tot.adjustmentInflowsUgx,
    expenseUgx: tot.expenseUgx,
    supplierPaymentsUgx: tot.supplierPaymentsUgx,
    cashRefundsUgx: tot.cashRefundsUgx,
    adjustmentOutflowsUgx: tot.adjustmentOutflowsUgx,
  });
}

export type ReportsCashFlowInput = {
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
  dayCloses?: DayCloseSummary[];
  bounds: DateFilterBounds;
};

export function computeReportsPeriodCashFlow(input: ReportsCashFlowInput): ReportsPeriodCashFlow {
  const days = enumerateDaysInBounds(input.bounds);
  if (days.length === 0) {
    return { cashInUgx: 0, cashOutUgx: 0, netUgx: 0, unavailable: false };
  }

  let cashInUgx = 0;
  let cashOutUgx = 0;
  for (const day of days) {
    const auth = resolveReportAuthority(input.dayCloses, day);
    if (auth.closed) {
      const frozen = auth.frozenTotals ? periodCashFlowFromFrozenTotals(auth.frozenTotals) : null;
      if (!frozen) return UNAVAILABLE;
      cashInUgx += frozen.cashInUgx;
      cashOutUgx += frozen.cashOutUgx;
      continue;
    }
    const live = periodCashFlowFromDrawer(
      getDrawerCashForDayInput({
        sales: input.sales,
        returns: input.returns,
        products: input.products,
        debtPayments: input.debtPayments,
        cashExpenses: input.cashExpenses,
        supplierPayments: input.supplierPayments,
        cashDrawerAdjustments: input.cashDrawerAdjustments,
        shifts: input.shifts,
        dayDrawerOpens: input.dayDrawerOpens,
        formulaVersion: input.formulaVersion ?? "v2",
        day,
      }),
    );
    cashInUgx += live.cashInUgx;
    cashOutUgx += live.cashOutUgx;
  }
  return { cashInUgx, cashOutUgx, netUgx: cashInUgx - cashOutUgx, unavailable: false };
}
