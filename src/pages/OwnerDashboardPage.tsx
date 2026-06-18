import { useMemo } from "react";
import { useMarkOwnerRisksReviewed } from "../hooks/useMarkOwnerRisksReviewed";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { DateFilterArchiveNotice } from "../components/shared/DateFilterArchiveNotice";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { buildOwnerDashboardData, buildOwnerSummaryLines } from "../lib/ownerDashboardData";
import { useDrawerCashForToday, useExpectedDrawerCashForBounds } from "../hooks/useDrawerCashForDay";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { dateKeyKampala } from "../lib/datesUg";
import { buildOwnerStaffPerformanceRows } from "../lib/ownerStaffMetrics";
import { canRecordCashExpenses } from "../lib/cashExpenses";
import { useSessionActor } from "../context/SessionActorContext";
import { OwnerNeedsAttentionSection } from "../components/owner/OwnerNeedsAttentionSection";
import { OwnerBusinessTodaySection } from "../components/owner/OwnerBusinessTodaySection";
import { OwnerStaffPerformanceSection } from "../components/owner/OwnerStaffPerformanceSection";
import { OwnerInventoryHealthSection } from "../components/owner/OwnerInventoryHealthSection";
import { OwnerQuickActionsRow } from "../components/owner/OwnerQuickActionsRow";
import { OwnerDashboardHeroCard } from "../components/owner/OwnerDashboardHeroCard";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { returnMatchesFilter, saleMatchesFilter } from "../lib/dateFilters";
import { isCompletedSale } from "../lib/saleStatus";
import { getCompletedFinancialsFromScoped } from "../lib/financialMetrics";
import { selectedDayKeyForFilter } from "../lib/dateFilterLabels";
import { timedComputation } from "../lib/performanceMetrics";
import { buildSalesFingerprint, getCachedComputation } from "../lib/computationResultCache";

function pulseLabel(lang: Language, pulse: ReturnType<typeof buildOwnerDashboardData>["pulse"]): string {
  if (pulse === "strong") return t(lang, "ownerPulseStrong");
  if (pulse === "steady") return t(lang, "ownerPulseSteady");
  return t(lang, "ownerPulseWatch");
}

export function OwnerDashboardPage({ lang }: { lang: Language }) {
  useMarkOwnerRisksReviewed();
  const actor = useSessionActor();
  const {
    filter,
    setFilter,
    bounds,
    includeArchived,
    setIncludeArchived,
    archiveNotice,
    archivedSalesCount,
    needsArchive,
  } = useReportingDateFilter();
  const sales = useDeferredReportingSales(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const preferences = usePosStore((s) => s.preferences);
  const hospitalityMode = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const voidRecords = usePosStore((s) => s.voidRecords);
  const archivedVoidRecords = usePosStore((s) => s.archivedVoidRecords);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const reportingVoidRecords = includeArchived ? [...voidRecords, ...archivedVoidRecords] : voidRecords;
  const reportingReturnRecords = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;
  const drawerToday = useDrawerCashForToday();
  const heroExpectedCash = useExpectedDrawerCashForBounds(bounds);

  const selectedDay = selectedDayKeyForFilter(filter);
  const heroCountedCash = useMemo(() => {
    if (!selectedDay) return null;
    const close = dayCloses.find((c) => c.dateKey === selectedDay && !c.supersededAt);
    return close?.countedCashUgx ?? null;
  }, [selectedDay, dayCloses]);

  const dashboard = useMemo(() => {
    const fp = `${buildSalesFingerprint(sales)}:${products.length}:${auditLogs.length}:${reportingReturnRecords.length}:${reportingVoidRecords.length}:${dayCloses.length}:${drawerToday}:${hospitalityMode}:${pharmacyMode}`;
    return getCachedComputation("buildOwnerDashboardData", fp, () =>
      timedComputation("buildOwnerDashboardData", () =>
        buildOwnerDashboardData({
          lang,
          sales,
          products,
          auditLogs,
          returnRecords: reportingReturnRecords,
          voidRecords: reportingVoidRecords,
          dayCloses,
          preferences,
          drawerToday,
          hospitalityMode,
          pharmacyMode,
        }),
      ),
    );
  }, [
    lang,
    sales,
    products,
    auditLogs,
    reportingReturnRecords,
    reportingVoidRecords,
    dayCloses,
    preferences,
    drawerToday,
    hospitalityMode,
    pharmacyMode,
  ]);

  const heroFinancials = useMemo(() => {
    const filteredSales = sales.filter((s) => isCompletedSale(s) && saleMatchesFilter(s, bounds));
    const allReturns = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;
    const filteredReturns = allReturns.filter((r) => returnMatchesFilter(r, bounds));
    return getCompletedFinancialsFromScoped(filteredSales, filteredReturns, products);
  }, [sales, bounds, products, includeArchived, returnRecords, archivedReturnRecords]);

  const { summaryLines, waLine, trendLine } = useMemo(
    () => buildOwnerSummaryLines(lang, dashboard),
    [lang, dashboard],
  );

  const { stats, fastMovers, cashierPerf, lowStock, pulse, riskCards, todayKey } = dashboard;

  const todayAuditLogs = useMemo(
    () => auditLogs.filter((e) => dateKeyKampala(e.at) === todayKey),
    [auditLogs, todayKey],
  );

  const staffRows = useMemo(
    () => buildOwnerStaffPerformanceRows(lang, dashboard.trustRows, cashierPerf, todayAuditLogs),
    [lang, dashboard.trustRows, cashierPerf, todayAuditLogs],
  );

  const totalDebtUgx = useMemo(
    () => customers.reduce((a, c) => a + c.debtBalanceUgx, 0),
    [customers],
  );

  const showRecordExpense = canRecordCashExpenses(actor.role, preferences);

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{t(lang, "ownerDashboardTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">{t(lang, "ownerDashboardSub")}</p>
      </div>

      <OwnerDashboardHeroCard
        lang={lang}
        salesUgx={heroFinancials.revenueUgx}
        profitUgx={heroFinancials.profitUgx}
        expectedCashUgx={heroExpectedCash}
        saleCount={heroFinancials.transactionCount}
        countedCashUgx={heroCountedCash}
        filter={filter}
        onFilterChange={setFilter}
      />

      {archiveNotice ? (
        <DateFilterArchiveNotice
          lang={lang}
          archivedCount={archivedSalesCount}
          onEnableArchived={() => setIncludeArchived(true)}
        />
      ) : null}
      {needsArchive && includeArchived && archivedSalesCount > 0 ? (
        <p className="text-xs font-semibold text-stone-600">{t(lang, "dateFilterArchiveIncluded")}</p>
      ) : null}

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      <OwnerNeedsAttentionSection lang={lang} cards={riskCards} todayKey={todayKey} />

      <OwnerBusinessTodaySection
        lang={lang}
        stats={stats}
        trendLine={trendLine}
        pulseLabel={pulseLabel(lang, pulse)}
        customersCount={customers.length}
        totalDebtUgx={totalDebtUgx}
        fastMovers={fastMovers}
        summaryLines={summaryLines}
        waLine={waLine}
      />

      <OwnerStaffPerformanceSection lang={lang} rows={staffRows} todayKey={todayKey} />

      <OwnerInventoryHealthSection lang={lang} lowStock={lowStock} fastMovers={fastMovers} />

      <OwnerQuickActionsRow lang={lang} showRecordExpense={showRecordExpense} />
    </div>
  );
}
