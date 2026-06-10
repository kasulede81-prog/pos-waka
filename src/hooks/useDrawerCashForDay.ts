import { useEffect, useMemo } from "react";
import { dateKeyKampala } from "../lib/datesUg";
import { getDrawerCashForDayInput, type DrawerCashSnapshot } from "../lib/cashReconciliation";
import { usePosStore, ensureAllActiveSalesLoaded } from "../store/usePosStore";
import { useReportingSales } from "./useReportingSales";
import { useReportingReturnRecords } from "./useReportingReturnRecords";

/**
 * Canonical expected-cash inputs for owner-facing screens (Close Day, Cash Expenses,
 * Owner Dashboard, exports). Uses active sales/returns only — not archived buckets —
 * and loads the full active sales list from disk so RAM pagination cannot skew totals.
 */
export function useDrawerCashForDay(day: string): DrawerCashSnapshot {
  const sales = useReportingSales(false);
  const returns = useReportingReturnRecords(false);
  const products = usePosStore((s) => s.products);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const supplierPayments = usePosStore((s) => s.supplierPayments);

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
        day,
      }),
    [sales, returns, products, debtPayments, cashExpenses, supplierPayments, day],
  );
}

/** Today in Kampala — shared day key for drawer reconciliation UIs. */
export function useDrawerCashForToday(): DrawerCashSnapshot {
  const todayKey = dateKeyKampala(new Date());
  return useDrawerCashForDay(todayKey);
}
