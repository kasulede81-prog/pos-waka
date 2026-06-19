import { useCallback, useMemo } from "react";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { DateFilterArchiveNotice } from "../components/shared/DateFilterArchiveNotice";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useExpectedDrawerCashForBounds } from "../hooks/useDrawerCashForDay";
import { isPharmacyMode } from "../lib/pharmacy";
import { OwnerDashboardHeroCard } from "../components/owner/OwnerDashboardHeroCard";
import { OwnerAttentionCenterSection } from "../components/owner/OwnerAttentionCenterSection";
import { OwnerIntegrityStrip } from "../components/owner/OwnerIntegrityStrip";
import { OwnerShiftAccountabilitySection } from "../components/owner/OwnerShiftAccountabilitySection";
import { OwnerCashControlSection } from "../components/owner/OwnerCashControlSection";
import { OwnerInventoryRiskSection } from "../components/owner/OwnerInventoryRiskSection";
import { OwnerFinancialControlSection } from "../components/owner/OwnerFinancialControlSection";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { selectedDayKeyForFilter, formatDateFilterChipDay } from "../lib/dateFilterLabels";
import { getCachedOwnerCommandCenterBundle } from "../lib/ownerDashboardCommandCenter";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { computeSyncSalesStats } from "../offline/cloudSync";

export function OwnerDashboardPage({ lang }: { lang: Language }) {
  const sync = useSyncStatus();
  const acknowledgeOwnerAlert = usePosStore((s) => s.acknowledgeOwnerAlert);
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
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const inventoryCountSessions = usePosStore((s) => s.inventoryCountSessions);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const preferences = usePosStore((s) => s.preferences);
  const acknowledgements = preferences.ownerAlertAcknowledgements ?? [];
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

  const syncStats = useMemo(() => computeSyncSalesStats(sales), [sales]);

  const commandCenter = useMemo(
    () =>
      getCachedOwnerCommandCenterBundle({
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
        cashExpenses,
        debtPayments,
        stockMovements,
        inventoryCountSessions,
        auditLogs,
        voidRecords: reportingVoidRecords,
        returnRecords: reportingReturnRecords,
        preferences,
        acknowledgements,
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
      cashExpenses,
      debtPayments,
      stockMovements,
      inventoryCountSessions,
      auditLogs,
      reportingVoidRecords,
      reportingReturnRecords,
      preferences,
      acknowledgements,
      heroExpectedCash,
      pharmacyMode,
      sync.pendingCount,
      syncStats.errorCount,
    ],
  );

  const onAcknowledge = useCallback(
    (alertId: string) => {
      acknowledgeOwnerAlert(alertId);
    },
    [acknowledgeOwnerAlert],
  );

  const { overview } = commandCenter;

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{t(lang, "ownerDashboardTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">{t(lang, "ownerDashboardCommandSub")}</p>
      </div>

      <OwnerDashboardHeroCard
        lang={lang}
        salesUgx={overview.revenueUgx}
        profitUgx={overview.profitUgx}
        expectedCashUgx={heroExpectedCash}
        saleCount={overview.transactionCount}
        countedCashUgx={overview.countedCashUgx}
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

      <OwnerAttentionCenterSection
        lang={lang}
        critical={commandCenter.attention.critical}
        warnings={commandCenter.attention.warnings}
        information={commandCenter.attention.information}
        reviewedCritical={commandCenter.attentionReviewed.critical}
        reviewedWarnings={commandCenter.attentionReviewed.warnings}
        periodLabel={periodLabel}
        onAcknowledge={onAcknowledge}
      />

      <OwnerCashControlSection lang={lang} cash={commandCenter.cash} />

      <OwnerShiftAccountabilitySection
        lang={lang}
        rows={commandCenter.shiftRows}
        periodLabel={periodLabel}
      />

      <OwnerInventoryRiskSection lang={lang} inventory={commandCenter.inventory} />

      <OwnerFinancialControlSection
        lang={lang}
        financial={commandCenter.financial}
        periodLabel={periodLabel}
      />

      <OwnerIntegrityStrip lang={lang} signals={commandCenter.integritySignals} />
    </div>
  );
}
