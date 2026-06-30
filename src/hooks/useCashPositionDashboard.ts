import { useDeferredValue, useMemo } from "react";
import type { Language } from "../types";
import { DEFAULT_DATE_FILTER, type DateFilterValue } from "../lib/dateFilters";
import { buildCashPositionDashboard } from "../lib/cashPositionDashboard";
import { buildSalesFingerprint, getCachedComputation } from "../lib/computationResultCache";
import { dateKeyKampala } from "../lib/datesUg";
import { timedComputation } from "../lib/performanceMetrics";
import { usePosStore } from "../store/usePosStore";
import { useReportingSales } from "./useReportingSales";
import { useReportingReturnRecords } from "./useReportingReturnRecords";
import { t } from "../lib/i18n";

export function useCashPositionDashboard(lang: Language, filter: DateFilterValue = DEFAULT_DATE_FILTER) {
  const sales = useReportingSales(false);
  const returnRecords = useReportingReturnRecords(false);
  const products = usePosStore((s) => s.products);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const formulaVersion = usePosStore((s) => s.preferences.cashDrawerFormulaVersion ?? "v1");
  const preferences = usePosStore((s) => s.preferences);
  const todayKey = dateKeyKampala(new Date());
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const generalLabel = t(lang, "uncategorized");

  const dashboard = useMemo(() => {
    const fp = [
      filter.kind,
      filter.kind === "preset" ? filter.preset : "",
      filter.kind === "day" ? filter.dateKey : "",
      filter.kind === "range" ? `${filter.fromKey}:${filter.toKey}` : "",
      buildSalesFingerprint(sales),
      returnRecords.length,
      debtPayments.length,
      cashExpenses.length,
      supplierPayments.length,
      cashDrawerAdjustments.length,
      dayDrawerOpens.length,
      dayCloses.length,
      formulaVersion,
      preferences.cashSafeLimitUgx ?? "",
    ].join("|");
    return getCachedComputation("buildCashPositionDashboard", fp, () =>
      timedComputation("buildCashPositionDashboard", () =>
        buildCashPositionDashboard({
          lang,
          filter,
          shopName,
          sales,
          products,
          returnRecords,
          debtPayments,
          cashExpenses,
          supplierPayments,
          cashDrawerAdjustments,
          shifts,
          dayDrawerOpens,
          dayCloses,
          formulaVersion,
          staffAccounts: preferences.staffAccounts ?? [],
          generalCategoryLabel: generalLabel,
          cashSafeLimitUgx: preferences.cashSafeLimitUgx,
          todayKey,
        }),
      ),
    );
  }, [
    filter,
    lang,
    shopName,
    sales,
    products,
    returnRecords,
    debtPayments,
    cashExpenses,
    supplierPayments,
    cashDrawerAdjustments,
    shifts,
    dayDrawerOpens,
    dayCloses,
    formulaVersion,
    preferences.staffAccounts,
    preferences.cashSafeLimitUgx,
    generalLabel,
    todayKey,
  ]);

  const displayDashboard = useDeferredValue(dashboard);
  const isStale = displayDashboard !== dashboard;

  return { dashboard: displayDashboard, isStale, todayKey, preferences };
}
