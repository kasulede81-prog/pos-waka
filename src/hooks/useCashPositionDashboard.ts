import { useDeferredValue, useMemo } from "react";
import type { Language } from "../types";
import { DEFAULT_DATE_FILTER, type DateFilterValue } from "../lib/dateFilters";
import {
  buildCashPositionDashboard,
  buildCashPositionDashboardFingerprint,
} from "../lib/cashPositionDashboard";
import { getCachedComputation } from "../lib/computationResultCache";
import { dateKeyKampala } from "../lib/datesUg";
import { resolveCashDrawerFormulaVersion } from "../lib/dayDrawerOpen";
import { timedComputation } from "../lib/performanceMetrics";
import { getActiveShopId } from "../offline/shopScope";
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
  const formulaVersion = usePosStore((s) => resolveCashDrawerFormulaVersion(s.preferences));
  const preferences = usePosStore((s) => s.preferences);
  const todayKey = dateKeyKampala(new Date());
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const generalLabel = t(lang, "uncategorized");
  const shopId = getActiveShopId();

  const dashboard = useMemo(() => {
    const fp = buildCashPositionDashboardFingerprint({
      shopId,
      filter,
      sales,
      products,
      staffAccounts: preferences.staffAccounts ?? [],
      returnRecords,
      debtPayments,
      cashExpenses,
      supplierPayments,
      cashDrawerAdjustments,
      dayDrawerOpens,
      dayCloses,
      shifts,
      formulaVersion,
      cashSafeLimitUgx: preferences.cashSafeLimitUgx,
      lang,
      shopName,
      generalCategoryLabel: generalLabel,
      todayKey,
    });
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
    shopId,
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
