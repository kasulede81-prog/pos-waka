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
import { useExpectedDrawerCashForBounds } from "../hooks/useDrawerCashForDay";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { buildOwnerStaffPerformanceRows } from "../lib/ownerStaffMetrics";
import { canRecordCashExpenses } from "../lib/cashExpenses";
import { useSessionActor } from "../context/SessionActorContext";
import { OwnerBusinessTodaySection } from "../components/owner/OwnerBusinessTodaySection";
import { OwnerStaffPerformanceSection } from "../components/owner/OwnerStaffPerformanceSection";
import { OwnerInventoryHealthSection } from "../components/owner/OwnerInventoryHealthSection";
import { OwnerQuickActionsRow } from "../components/owner/OwnerQuickActionsRow";
import { OwnerDashboardHeroCard } from "../components/owner/OwnerDashboardHeroCard";
import { OwnerAttentionCenterSection } from "../components/owner/OwnerAttentionCenterSection";
import { OwnerIntegrityStrip } from "../components/owner/OwnerIntegrityStrip";
import { OwnerShiftAccountabilitySection } from "../components/owner/OwnerShiftAccountabilitySection";
import { OwnerCashControlSection } from "../components/owner/OwnerCashControlSection";
import { OwnerInventoryRiskSection } from "../components/owner/OwnerInventoryRiskSection";
import { OwnerFinancialControlSection } from "../components/owner/OwnerFinancialControlSection";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { returnMatchesFilter, saleMatchesFilter } from "../lib/dateFilters";
import { isCompletedSale } from "../lib/saleStatus";
import { getCompletedFinancialsFromScoped } from "../lib/financialMetrics";
import { selectedDayKeyForFilter, formatDateFilterChipDay } from "../lib/dateFilterLabels";
import { timedComputation } from "../lib/performanceMetrics";
import { buildSalesFingerprint, getCachedComputation } from "../lib/computationResultCache";
import {
  buildAttentionCenter,
  buildCashControlSnapshot,
  buildFinancialSnapshot,
  buildIntegritySignals,
  buildInventoryRiskSnapshot,
  buildShiftAccountabilityRows,
  filterAuditLogsInBounds,
  primaryDayKeyForBounds,
} from "../lib/ownerCommandCenter";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { computeSyncSalesStats } from "../offline/cloudSync";

function pulseLabel(lang: Language, pulse: ReturnType<typeof buildOwnerDashboardData>["pulse"]): string {
  if (pulse === "strong") return t(lang, "ownerPulseStrong");
  if (pulse === "steady") return t(lang, "ownerPulseSteady");
  return t(lang, "ownerPulseWatch");
}

export function OwnerDashboardPage({ lang }: { lang: Language }) {
  useMarkOwnerRisksReviewed();
  const actor = useSessionActor();
  const sync = useSyncStatus();
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
  const suppliers = usePosStore((s) => s.suppliers);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const inventoryCountSessions = usePosStore((s) => s.inventoryCountSessions);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
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
  const heroExpectedCash = useExpectedDrawerCashForBounds(bounds);

  const periodLabel = useMemo(() => {
    const day = selectedDayKeyForFilter(filter);
    if (day) return formatDateFilterChipDay(day, lang);
    if (filter.kind === "preset" && filter.preset === "this_week") return t(lang, "dateFilterThisWeek");
    if (filter.kind === "preset" && filter.preset === "this_month") return t(lang, "dateFilterThisMonth");
    return t(lang, "dateFilterToday");
  }, [filter, lang]);

  const dashboard = useMemo(() => {
    const fp = `${buildSalesFingerprint(sales)}:${bounds.fromKey}:${bounds.toKey}:${products.length}:${auditLogs.length}:${reportingReturnRecords.length}:${reportingVoidRecords.length}:${dayCloses.length}:${heroExpectedCash}:${hospitalityMode}:${pharmacyMode}`;
    return getCachedComputation("buildOwnerDashboardData", fp, () =>
      timedComputation("buildOwnerDashboardData", () =>
        buildOwnerDashboardData({
          lang,
          bounds,
          sales,
          products,
          auditLogs,
          returnRecords: reportingReturnRecords,
          voidRecords: reportingVoidRecords,
          dayCloses,
          preferences,
          debtPayments,
          expectedCashUgx: heroExpectedCash,
          hospitalityMode,
          pharmacyMode,
        }),
      ),
    );
  }, [
    lang,
    bounds,
    sales,
    products,
    auditLogs,
    reportingReturnRecords,
    reportingVoidRecords,
    dayCloses,
    preferences,
    debtPayments,
    heroExpectedCash,
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

  const { stats, fastMovers, cashierPerf, lowStock, pulse, riskCards } = dashboard;

  const periodAuditLogs = useMemo(
    () => filterAuditLogsInBounds(auditLogs, bounds),
    [auditLogs, bounds],
  );

  const staffRows = useMemo(
    () => buildOwnerStaffPerformanceRows(lang, dashboard.trustRows, cashierPerf, periodAuditLogs),
    [lang, dashboard.trustRows, cashierPerf, periodAuditLogs],
  );

  const totalDebtUgx = useMemo(
    () => customers.reduce((a, c) => a + c.debtBalanceUgx, 0),
    [customers],
  );

  const syncStats = useMemo(() => computeSyncSalesStats(sales), [sales]);

  const attention = useMemo(
    () =>
      buildAttentionCenter({
        lang,
        bounds,
        sales,
        products,
        customers,
        suppliers,
        shifts,
        dayCloses,
        dayDrawerOpens,
        cashDrawerAdjustments,
        debtPayments,
        stockMovements,
        inventoryCountSessions,
        auditLogs,
        voidRecords: reportingVoidRecords,
        returnRecords: reportingReturnRecords,
        ownerAlertsResolved: dashboard.ownerAlertsResolved,
        riskCards,
        expectedCashUgx: heroExpectedCash,
        pharmacyMode,
        syncPendingCount: sync.pendingCount,
        syncErrorCount: syncStats.errorCount,
      }),
    [
      lang,
      bounds,
      sales,
      products,
      customers,
      suppliers,
      shifts,
      dayCloses,
      dayDrawerOpens,
      cashDrawerAdjustments,
      debtPayments,
      stockMovements,
      inventoryCountSessions,
      auditLogs,
      reportingVoidRecords,
      reportingReturnRecords,
      dashboard.ownerAlertsResolved,
      riskCards,
      heroExpectedCash,
      pharmacyMode,
      sync.pendingCount,
      syncStats.errorCount,
    ],
  );

  const integritySignals = useMemo(
    () =>
      buildIntegritySignals({
        customers,
        sales,
        debtPayments,
        products,
        stockMovements,
        dayDrawerOpens,
        shifts,
        todayKey: dashboard.todayKey,
        syncPendingCount: sync.pendingCount,
        syncErrorCount: syncStats.errorCount,
      }),
    [
      customers,
      sales,
      debtPayments,
      products,
      stockMovements,
      dayDrawerOpens,
      shifts,
      dashboard.todayKey,
      sync.pendingCount,
      syncStats.errorCount,
    ],
  );

  const shiftRows = useMemo(
    () => buildShiftAccountabilityRows(shifts, bounds, lang),
    [shifts, bounds, lang],
  );

  const cashControl = useMemo(
    () =>
      buildCashControlSnapshot({
        bounds,
        primaryDayKey: primaryDayKeyForBounds(bounds),
        dayDrawerOpens,
        dayCloses,
        shifts,
        cashDrawerAdjustments,
        expectedCashUgx: heroExpectedCash,
        lang,
      }),
    [bounds, dayDrawerOpens, dayCloses, shifts, cashDrawerAdjustments, heroExpectedCash, lang],
  );

  const inventoryRisk = useMemo(
    () => buildInventoryRiskSnapshot(products, inventoryCountSessions, pharmacyMode),
    [products, inventoryCountSessions, pharmacyMode],
  );

  const financial = useMemo(
    () => buildFinancialSnapshot({ sales, customers, suppliers, debtPayments, bounds }),
    [sales, customers, suppliers, debtPayments, bounds],
  );

  const selectedDay = selectedDayKeyForFilter(filter);
  const heroCountedCash = useMemo(() => {
    if (!bounds.isSingleDay) return null;
    const key = selectedDay ?? bounds.toKey;
    const close = dayCloses.find((c) => c.dateKey === key && !c.supersededAt);
    return close?.countedCashUgx ?? null;
  }, [bounds.isSingleDay, selectedDay, bounds.toKey, dayCloses]);

  const showRecordExpense = canRecordCashExpenses(actor.role, preferences);

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{t(lang, "ownerDashboardTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">{t(lang, "ownerDashboardCommandSub")}</p>
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

      <OwnerIntegrityStrip lang={lang} signals={integritySignals} />

      <OwnerAttentionCenterSection
        lang={lang}
        critical={attention.critical}
        warnings={attention.warnings}
        information={attention.information}
        periodLabel={periodLabel}
      />

      <OwnerCashControlSection lang={lang} cash={cashControl} />

      <OwnerShiftAccountabilitySection lang={lang} rows={shiftRows} periodLabel={periodLabel} />

      <OwnerFinancialControlSection lang={lang} financial={financial} periodLabel={periodLabel} />

      <OwnerInventoryRiskSection lang={lang} inventory={inventoryRisk} />

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

      <OwnerStaffPerformanceSection
        lang={lang}
        rows={staffRows}
        periodFromKey={bounds.fromKey}
        periodToKey={bounds.toKey}
      />

      <OwnerInventoryHealthSection lang={lang} lowStock={lowStock} fastMovers={fastMovers} />

      <OwnerQuickActionsRow lang={lang} showRecordExpense={showRecordExpense} />
    </div>
  );
}
