import { useEffect, useMemo } from "react";
import { dateKeyKampala } from "../lib/datesUg";
import { resolveCashDrawerFormulaVersion } from "../lib/dayDrawerOpen";
import {
  getDrawerCashForDayInput,
  type DrawerCashSnapshot,
} from "../lib/cashReconciliation";
import type { DateFilterBounds } from "../lib/dateFilters";
import { usePosStore, ensureAllActiveSalesLoaded } from "../store/usePosStore";
import { useReportingSales } from "./useReportingSales";
import { useReportingReturnRecords } from "./useReportingReturnRecords";

/**
 * Canonical expected-cash inputs for owner-facing screens (Close Day, Cash Position,
 * Owner Dashboard, exports). Uses V2 drawer ledger formula.
 */
export function useDrawerCashForDay(day: string): DrawerCashSnapshot {
  const sales = useReportingSales(false);
  const returns = useReportingReturnRecords(false);
  const products = usePosStore((s) => s.products);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const formulaVersion = usePosStore((s) => resolveCashDrawerFormulaVersion(s.preferences));

  useEffect(() => {
    void ensureAllActiveSalesLoaded();
  }, []);

  return useMemo(
    () =>
      getDrawerCashForDayInput({
        sales,
        returns,
        products,
        debtPayments,
        cashExpenses,
        supplierPayments,
        cashDrawerAdjustments,
        shifts,
        dayDrawerOpens,
        formulaVersion,
        day,
      }),
    [sales, returns, products, debtPayments, cashExpenses, supplierPayments, cashDrawerAdjustments, shifts, dayDrawerOpens, formulaVersion, day],
  );
}

/** Expected drawer cash for a date filter — single-day Drawer V2 snapshot, or null for ranges. */
export function useExpectedDrawerCashForBounds(bounds: DateFilterBounds): number | null {
  const sales = useReportingSales(false);
  const returns = useReportingReturnRecords(false);
  const products = usePosStore((s) => s.products);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const formulaVersion = usePosStore((s) => resolveCashDrawerFormulaVersion(s.preferences));

  useEffect(() => {
    void ensureAllActiveSalesLoaded();
  }, []);

  return useMemo(() => {
    if (!bounds.isSingleDay) return null;
    const input = {
      sales,
      returns,
      products,
      debtPayments,
      cashExpenses,
      supplierPayments,
      cashDrawerAdjustments,
      shifts,
      dayDrawerOpens,
      formulaVersion,
    };
    return getDrawerCashForDayInput({ ...input, day: bounds.fromKey }).expectedDrawerCashUgx;
  }, [
    bounds.fromKey,
    bounds.toKey,
    bounds.isSingleDay,
    sales,
    returns,
    products,
    debtPayments,
    cashExpenses,
    supplierPayments,
    cashDrawerAdjustments,
    shifts,
    dayDrawerOpens,
    formulaVersion,
  ]);
}

/** Today in Kampala — shared day key for drawer reconciliation UIs. */
export function useDrawerCashForToday(): DrawerCashSnapshot {
  const todayKey = dateKeyKampala(new Date());
  return useDrawerCashForDay(todayKey);
}
