import { useEffect, useMemo } from "react";
import { dateKeyKampala } from "../lib/datesUg";
import {
  getDrawerCashForDayInput,
  sumExpectedDrawerCashForBounds,
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
  const formulaVersion = usePosStore((s) => s.preferences.cashDrawerFormulaVersion ?? "v1");

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

/** Expected drawer cash for a date filter (single day snapshot or summed range). */
export function useExpectedDrawerCashForBounds(bounds: DateFilterBounds): number {
  const sales = useReportingSales(false);
  const returns = useReportingReturnRecords(false);
  const products = usePosStore((s) => s.products);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const formulaVersion = usePosStore((s) => s.preferences.cashDrawerFormulaVersion ?? "v1");

  useEffect(() => {
    void ensureAllActiveSalesLoaded();
  }, []);

  return useMemo(() => {
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
    if (bounds.isSingleDay) {
      return getDrawerCashForDayInput({ ...input, day: bounds.fromKey }).expectedDrawerCashUgx;
    }
    return sumExpectedDrawerCashForBounds(input, bounds);
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
