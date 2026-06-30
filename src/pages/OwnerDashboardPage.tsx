import { useCallback, useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { DateFilterArchiveNotice } from "../components/shared/DateFilterArchiveNotice";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useExpectedDrawerCashForBounds } from "../hooks/useDrawerCashForDay";
import { isPharmacyMode } from "../lib/pharmacy";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { formatDateFilterViewingLabel } from "../lib/dateFilterLabels";
import { getCachedOwnerCommandCenterBundle } from "../lib/ownerDashboardCommandCenter";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { computeSyncSalesStats } from "../offline/cloudSync";
import { buildCloudRecoverySnapshotFromStore } from "../lib/cloudAuthorityAudit";
import { useOwnerDeviceHealth } from "../hooks/useOwnerDeviceHealth";
import { PageHeader } from "../components/layout/PageHeader";
import { CommandCenterPageToolbar } from "../components/command-center/CommandCenterPageToolbar";
import { CommandCenterHealthHero } from "../components/command-center/CommandCenterHealthHero";
import { CommandCenterKpiGrid } from "../components/command-center/CommandCenterKpiGrid";
import { CommandCenterAttentionSection } from "../components/command-center/CommandCenterAttentionSection";
import { CommandCenterCloudCard } from "../components/command-center/CommandCenterCloudCard";
import { CommandCenterLiveOpsTiles } from "../components/command-center/CommandCenterLiveOpsTiles";
import { CommandCenterCashCard } from "../components/command-center/CommandCenterCashCard";
import { CommandCenterStaffCard } from "../components/command-center/CommandCenterStaffCard";
import { CommandCenterInventoryCard } from "../components/command-center/CommandCenterInventoryCard";
import { CommandCenterFinancialGrid } from "../components/command-center/CommandCenterFinancialGrid";
import { CommandCenterIntegrityPanel } from "../components/command-center/CommandCenterIntegrityPanel";
import { CommandCenterRecommendations } from "../components/command-center/CommandCenterRecommendations";
import { CommandCenterQuickActions } from "../components/command-center/CommandCenterQuickActions";
import { CommandCenterExecutiveFooter } from "../components/command-center/CommandCenterExecutiveFooter";
import {
  buildCommandCenterExportText,
  buildExecutiveSummary,
  buildKpiCards,
  buildSmartRecommendations,
  computeBusinessHealthScore,
  computeDailyRevenueSparkline,
  countUniqueCustomers,
  deriveDomainStatuses,
  filterAttentionByQuery,
} from "../lib/commandCenterPageView";
import { shareText } from "../lib/reportExport";

const RECOMMENDATIONS_SECTION_ID = "cmd-center-recommendations";

export function OwnerDashboardPage({ lang }: { lang: Language }) {
  const sync = useSyncStatus();
  const deviceHealth = useOwnerDeviceHealth();
  const acknowledgeOwnerAlert = usePosStore((s) => s.acknowledgeOwnerAlert);
  const preferences = usePosStore((s) => s.preferences);
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
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
  const purchases = usePosStore((s) => s.purchases);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const inventoryCountSessions = usePosStore((s) => s.inventoryCountSessions);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
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

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const periodLabel = useMemo(() => formatDateFilterViewingLabel(lang, filter), [filter, lang]);
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
        purchases,
        supplierPayments,
        preferences,
        acknowledgements,
        expectedCashUgx: heroExpectedCash,
        pharmacyMode,
        syncPendingCount: sync.pendingCount,
        syncErrorCount: syncStats.errorCount,
        syncHealth: sync.health,
        devicesOnline: deviceHealth.devicesOnline,
        devicesStale: deviceHealth.devicesStale,
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
      purchases,
      supplierPayments,
      preferences,
      acknowledgements,
      heroExpectedCash,
      pharmacyMode,
      sync.pendingCount,
      syncStats.errorCount,
      sync.health,
      deviceHealth.devicesOnline,
      deviceHealth.devicesStale,
    ],
  );

  const cloudProtection = useMemo(() => buildCloudRecoverySnapshotFromStore(), [
    commandCenter,
    sync.pendingCount,
    sync.health.lastSuccessAt,
  ]);

  const { overview } = commandCenter;
  const revenueSparkline = useMemo(() => computeDailyRevenueSparkline(sales), [sales]);
  const customerCount = useMemo(() => countUniqueCustomers(sales, bounds), [sales, bounds]);

  const healthScore = useMemo(
    () =>
      computeBusinessHealthScore(
        commandCenter.integritySignals,
        commandCenter.attention.critical.length,
        commandCenter.attention.warnings.length,
        cloudProtection.scorePct,
      ),
    [commandCenter, cloudProtection.scorePct],
  );

  const domainStatuses = useMemo(
    () =>
      deriveDomainStatuses(
        commandCenter.integritySignals,
        commandCenter.attention.critical.length,
        deviceHealth.devicesStale,
        commandCenter.cash.hasUnresolvedVariance,
      ),
    [commandCenter, deviceHealth.devicesStale],
  );

  const kpiCards = useMemo(
    () => buildKpiCards(commandCenter.financial, heroExpectedCash, customerCount, revenueSparkline),
    [commandCenter.financial, heroExpectedCash, customerCount, revenueSparkline],
  );

  const recommendations = useMemo(
    () =>
      buildSmartRecommendations({
        inventory: commandCenter.inventory,
        receivablesUgx: commandCenter.financial.receivablesUgx,
        cashUnresolved: commandCenter.cash.hasUnresolvedVariance,
        pendingCountSessions: commandCenter.inventory.pendingCountSessions.length,
        slowMoversCount: commandCenter.inventory.slowMovers.length,
      }),
    [commandCenter],
  );

  const summaryKey = useMemo(
    () =>
      buildExecutiveSummary({
        score: healthScore,
        criticalCount: commandCenter.attention.critical.length,
        warningCount: commandCenter.attention.warnings.length,
      }),
    [healthScore, commandCenter.attention],
  );

  const summaryVars = useMemo((): Record<string, string | number> | undefined => {
    const critical = commandCenter.attention.critical.length;
    const warnings = commandCenter.attention.warnings.length;
    if (summaryKey === "cmdCenterSummaryMixed") {
      return { critical, warnings };
    }
    if (summaryKey === "cmdCenterSummaryCritical") return { count: critical };
    if (summaryKey === "cmdCenterSummaryWarnings") return { count: warnings };
    return undefined;
  }, [summaryKey, commandCenter.attention]);

  const filteredAttention = useMemo(() => {
    if (!searchQuery.trim()) return commandCenter.attention;
    return {
      critical: filterAttentionByQuery(commandCenter.attention.critical, searchQuery),
      warnings: filterAttentionByQuery(commandCenter.attention.warnings, searchQuery),
      information: filterAttentionByQuery(commandCenter.attention.information, searchQuery),
    };
  }, [commandCenter.attention, searchQuery]);

  const devicesTotal = deviceHealth.devicesOnline + deviceHealth.devicesStale;

  const onAcknowledge = useCallback(
    (alertId: string) => {
      acknowledgeOwnerAlert(alertId);
    },
    [acknowledgeOwnerAlert],
  );

  const exportDashboard = useCallback(() => {
    const text = buildCommandCenterExportText({
      shopName,
      periodLabel,
      score: healthScore,
      revenueUgx: overview.revenueUgx,
      profitUgx: overview.profitUgx,
      transactions: overview.transactionCount,
      expectedCashUgx: heroExpectedCash,
    });
    void shareText(text, `${shopName} Command Center`);
  }, [shopName, periodLabel, healthScore, overview, heroExpectedCash]);

  return (
    <div className="space-y-4 pb-10 sm:space-y-5">
      <PageHeader
        lang={lang}
        title={t(lang, "ownerDashboardTitle")}
        subtitle={t(lang, "cmdCenterSub")}
        compact
        showBack
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={exportDashboard}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-xs font-black text-stone-800 shadow-sm"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden />
            {t(lang, "cmdCenterExport")}
          </button>
        </div>
      </PageHeader>

      <CommandCenterPageToolbar
        lang={lang}
        filter={filter}
        onFilterChange={setFilter}
        searchOpen={searchOpen}
        onSearchToggle={() => setSearchOpen((v) => !v)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        shopName={shopName}
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

      <CommandCenterHealthHero lang={lang} score={healthScore} domains={domainStatuses} />

      <CommandCenterKpiGrid lang={lang} cards={kpiCards} periodLabel={periodLabel} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CommandCenterAttentionSection
          lang={lang}
          critical={filteredAttention.critical}
          warnings={filteredAttention.warnings}
          information={filteredAttention.information}
          reviewedCritical={commandCenter.attentionReviewed.critical}
          reviewedWarnings={commandCenter.attentionReviewed.warnings}
          periodLabel={periodLabel}
          onAcknowledge={onAcknowledge}
        />
        <CommandCenterCloudCard
          lang={lang}
          cloud={cloudProtection}
          devicesOnline={deviceHealth.devicesOnline}
          devicesTotal={devicesTotal || 1}
        />
      </div>

      <CommandCenterLiveOpsTiles lang={lang} live={commandCenter.liveOps} expectedCashUgx={heroExpectedCash} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CommandCenterCashCard lang={lang} cash={commandCenter.cash} />
        <CommandCenterStaffCard lang={lang} rows={commandCenter.shiftRows} periodLabel={periodLabel} />
      </div>

      <CommandCenterInventoryCard lang={lang} inventory={commandCenter.inventory} />

      <CommandCenterFinancialGrid
        lang={lang}
        financial={commandCenter.financial}
        periodLabel={periodLabel}
        revenueSparkline={revenueSparkline}
      />

      <CommandCenterIntegrityPanel lang={lang} signals={commandCenter.integritySignals} />

      <CommandCenterRecommendations
        lang={lang}
        recommendations={recommendations}
        sectionId={RECOMMENDATIONS_SECTION_ID}
      />

      <CommandCenterQuickActions lang={lang} />

      <CommandCenterExecutiveFooter
        lang={lang}
        score={healthScore}
        summaryKey={summaryKey}
        summaryVars={summaryVars}
        onExport={exportDashboard}
        onShare={exportDashboard}
      />
    </div>
  );
}
