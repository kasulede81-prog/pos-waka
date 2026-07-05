/**
 * @deprecated Import from dayCloseEnforcement — thin store adapter retained for tests.
 */

import { usePosStore } from "../store/usePosStore";
import { dateKeyKampala } from "./datesUg";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { resolveCashDrawerFormulaVersion } from "./dayDrawerOpen";
import {
  runDayClosePreflight as runEnforcementPreflight,
  type DayClosePreflightResult as EnforcementResult,
} from "./dayCloseEnforcement";

export type DayClosePreflightResult = {
  ok: boolean;
  warnings: string[];
  errorKey?: string;
  snapshot?: EnforcementResult["snapshot"];
  blockReasons?: string[];
};

/** Verify cloud state and operational gates before day close. */
export async function runDayClosePreflight(opts?: {
  dateKey?: string;
  countedCashUgx?: number | null;
}): Promise<DayClosePreflightResult> {
  const state = usePosStore.getState();
  const dateKey = opts?.dateKey ?? dateKeyKampala(new Date());
  const drawer = getDrawerCashForDayInput({
    sales: state.sales,
    returns: state.returnRecords,
    products: state.products,
    debtPayments: state.debtPayments,
    cashExpenses: state.cashExpenses,
    supplierPayments: state.supplierPayments,
    cashDrawerAdjustments: state.cashDrawerAdjustments,
    shifts: state.preferences.shifts ?? [],
    dayDrawerOpens: state.dayDrawerOpens,
    formulaVersion: resolveCashDrawerFormulaVersion(state.preferences),
    day: dateKey,
  });

  const result = await runEnforcementPreflight({
    state: {
      draftLines: state.draftLines,
      activePendingSaleId: state.activePendingSaleId,
      sales: state.sales,
      preferences: state.preferences,
      dayCloses: state.dayCloses,
      dayDrawerOpens: state.dayDrawerOpens,
      products: state.products,
      returnRecords: state.returnRecords,
      cashDrawerAdjustments: state.cashDrawerAdjustments,
      cashExpenses: state.cashExpenses,
      inventoryCountSessions: state.inventoryCountSessions,
    },
    dateKey,
    expectedCashUgx: drawer.expectedDrawerCashUgx,
    countedCashUgx: opts?.countedCashUgx ?? null,
    variancePreferences: state.preferences,
  });

  return {
    ok: result.ok,
    warnings: result.warnings,
    errorKey: result.errorKey,
    snapshot: result.snapshot,
    blockReasons: result.blockReasons,
  };
}
