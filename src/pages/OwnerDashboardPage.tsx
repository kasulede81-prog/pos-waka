import { useCallback, useMemo, useState } from "react";
import type { Language, Permission } from "../types";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { actorHasEffectivePermission } from "../lib/actorAuthorization";
import { authOperatorPermissions, authOperatorRole } from "../lib/sessionActor";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
import { usePosStore } from "../store/usePosStore";
import { useExpectedDrawerCashForBounds } from "../hooks/useDrawerCashForDay";
import { useDayClosesForAuthority } from "../hooks/useDayClosesForAuthority";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { formatDateFilterViewingLabel } from "../lib/dateFilterLabels";
import { getCachedOwnerCommandCenterBundle } from "../lib/ownerDashboardCommandCenter";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { computeSyncSalesStats } from "../offline/cloudSync";
import { buildCloudRecoverySnapshotFromStore } from "../lib/cloudAuthorityAudit";
import { useOwnerDeviceHealth } from "../hooks/useOwnerDeviceHealth";
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
  presentCommandCenterExpectedCash,
  presentCommandCenterOfficialFinancials,
  presentCommandCenterSparkline,
  commandCenterComparisonLabelKey,
  commandCenterOfficialExportValues,
} from "../lib/commandCenterPageView";
import { resolvePeriodReportAuthority } from "../lib/closedDayAuthority";
import {
  canExportReportsData,
  runReportsExportIfComplete,
  resolveReportsFinancialReadiness,
  sumFrozenPeriodHeadlines,
} from "../lib/reportsDataCompleteness";
import { shareText } from "../lib/reportExport";
import { buildCommandCenterExportRows } from "../lib/analyticsReportExport";
import { exportCsvFile, printReportDocument } from "../lib/reportExportEngine";
import { jsPDF } from "jspdf";
import { dateKeyKampala } from "../lib/datesUg";
import { EnterpriseDashboardShell } from "../components/command-center/EnterpriseDashboardShell";
import { isHospitalityMode } from "../lib/hospitality";
import { computeHospitalityDashboardStats } from "../lib/hospitalityStats";
import type { DashboardCenterContext } from "../components/command-center/registry/dashboardWidgetTypes";
import { resolveDashboardMode } from "../components/command-center/registry/dashboardMode";

const RECOMMENDATIONS_SECTION_ID = "cmd-center-recommendations";

export function OwnerDashboardPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const can = useCallback(
    (perm: Permission) => actorHasEffectivePermission(actor, perm, snapshot, authMode),
    [actor, snapshot, authMode],
  );
  const { canProfit } = resolveProfitVisibility({
    role: authOperatorRole(actor),
    snapshot,
    authMode,
    actorPermissions: authOperatorPermissions(actor),
  });
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
  const dayCloses = useDayClosesForAuthority();
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const inventoryCountSessions = usePosStore((s) => s.inventoryCountSessions);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const acknowledgements = preferences.ownerAlertAcknowledgements ?? [];
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const voidRecords = usePosStore((s) => s.voidRecords);
  const archivedVoidRecords = usePosStore((s) => s.archivedVoidRecords);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const reportingVoidRecords = includeArchived ? [...voidRecords, ...archivedVoidRecords] : voidRecords;
  const reportingReturnRecords = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;
  const liveExpectedCash = useExpectedDrawerCashForBounds(bounds);
  const heroExpectedCash = presentCommandCenterExpectedCash(bounds, dayCloses, liveExpectedCash);
  const hydrationStage = usePosStore((s) => s.hydrationStage);
  const salesHistoryHydration = usePosStore((s) => s.salesHistoryHydration);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const mode = resolveDashboardMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const pharmacyMode = mode === "pharmacy";
  const hospitalityStats = useMemo(() => {
    const floor = preferences.hospitalityFloor;
    if (mode !== "hospitality" || !floor || !isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) {
      return null;
    }
    return computeHospitalityDashboardStats(floor, sales);
  }, [mode, preferences.hospitalityFloor, preferences.businessType, preferences.hospitalityModeEnabled, sales]);
  const hospitalityFloor =
    mode === "hospitality" && isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)
      ? preferences.hospitalityFloor ?? null
      : null;
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
  const periodAuthority = useMemo(
    () => resolvePeriodReportAuthority(dayCloses, bounds),
    [dayCloses, bounds],
  );
  const financialReadiness = useMemo(
    () =>
      resolveReportsFinancialReadiness({
        hydrationStage,
        salesHistoryHydration,
        authority: periodAuthority,
      }),
    [hydrationStage, salesHistoryHydration, periodAuthority],
  );
  const frozenHeadlines = useMemo(
    () => (financialReadiness.canShowFrozenHeadlines ? sumFrozenPeriodHeadlines(dayCloses, bounds) : null),
    [financialReadiness.canShowFrozenHeadlines, dayCloses, bounds],
  );
  const officialFinancials = useMemo(
    () =>
      presentCommandCenterOfficialFinancials({
        readiness: financialReadiness,
        overlaid: {
          revenueUgx: overview.revenueUgx,
          profitUgx: overview.profitUgx,
          transactionCount: overview.transactionCount,
          costIncomplete: overview.costIncomplete,
        },
        frozenHeadlines,
      }),
    [financialReadiness, overview, frozenHeadlines],
  );
  const revenueSparkline = useMemo(
    () =>
      presentCommandCenterSparkline(computeDailyRevenueSparkline(sales), {
        bounds,
        authority: periodAuthority,
        dataComplete: financialReadiness.dataComplete,
      }),
    [sales, bounds, periodAuthority, financialReadiness.dataComplete],
  );
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

  const comparisonLabelKey = useMemo(() => commandCenterComparisonLabelKey(bounds), [bounds]);

  const kpiCards = useMemo(
    () =>
      buildKpiCards(
        commandCenter.financial,
        heroExpectedCash,
        customerCount,
        revenueSparkline,
        officialFinancials,
        canProfit,
      ),
    [commandCenter.financial, heroExpectedCash, customerCount, revenueSparkline, officialFinancials, canProfit],
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
      critical: filterAttentionByQuery(commandCenter.attention.critical, searchQuery, lang),
      warnings: filterAttentionByQuery(commandCenter.attention.warnings, searchQuery, lang),
      information: filterAttentionByQuery(commandCenter.attention.information, searchQuery, lang),
    };
  }, [commandCenter.attention, searchQuery]);

  const devicesTotal = deviceHealth.devicesOnline + deviceHealth.devicesStale;

  const onAcknowledge = useCallback(
    (alertId: string) => {
      acknowledgeOwnerAlert(alertId);
    },
    [acknowledgeOwnerAlert],
  );

  const exportDashboard = useCallback(async () => {
    if (!canExportReportsData(financialReadiness)) return;
    const official = commandCenterOfficialExportValues(officialFinancials);
    if (!official) return;
    const rows = runReportsExportIfComplete(financialReadiness.dataComplete, () =>
      buildCommandCenterExportRows({
        lang,
        shopName,
        periodLabel,
        score: healthScore,
        revenueUgx: official.revenueUgx,
        profitUgx: canProfit ? official.profitUgx : undefined,
        costIncomplete: official.costIncomplete,
        transactions: official.transactionCount,
        expectedCashUgx: heroExpectedCash,
        includeProfit: canProfit,
      }),
    );
    if (!rows) return;
    await exportCsvFile("command_center", `waka-command-center-${dateKeyKampala(new Date())}.csv`, rows, {
      shareDialogTitle: `${shopName} Command Center`,
    });
  }, [lang, shopName, periodLabel, healthScore, officialFinancials, heroExpectedCash, financialReadiness, canProfit]);

  const shareDashboard = useCallback(() => {
    if (!canExportReportsData(financialReadiness)) return;
    const official = commandCenterOfficialExportValues(officialFinancials);
    if (!official) return;
    const text = runReportsExportIfComplete(financialReadiness.dataComplete, () =>
      buildCommandCenterExportText({
        shopName,
        periodLabel,
        score: healthScore,
        revenueUgx: official.revenueUgx,
        profitUgx: canProfit ? official.profitUgx : undefined,
        costIncomplete: official.costIncomplete,
        transactions: official.transactionCount,
        expectedCashUgx: heroExpectedCash,
        includeProfit: canProfit,
      }),
    );
    if (!text) return;
    void shareText(text, `${shopName} Command Center`, "command_center");
  }, [shopName, periodLabel, healthScore, officialFinancials, heroExpectedCash, financialReadiness, canProfit]);

  const printDashboard = useCallback(async () => {
    if (!canExportReportsData(financialReadiness)) return;
    const official = commandCenterOfficialExportValues(officialFinancials);
    if (!official) return;
    const text = runReportsExportIfComplete(financialReadiness.dataComplete, () =>
      buildCommandCenterExportText({
        shopName,
        periodLabel,
        score: healthScore,
        revenueUgx: official.revenueUgx,
        profitUgx: canProfit ? official.profitUgx : undefined,
        costIncomplete: official.costIncomplete,
        transactions: official.transactionCount,
        expectedCashUgx: heroExpectedCash,
        includeProfit: canProfit,
      }),
    );
    if (!text) return;
    const filename = `waka-command-center-${dateKeyKampala(new Date())}.pdf`;
    await printReportDocument("command_center", {
      pdfFilename: filename,
      buildPdfBlob: () => {
        const doc = new jsPDF({ unit: "pt", format: "a4" });
        doc.setFontSize(10);
        let y = 40;
        for (const line of text.split("\n")) {
          doc.text(line, 40, y);
          y += 12;
          if (y > 760) {
            doc.addPage();
            y = 40;
          }
        }
        return doc.output("blob");
      },
      htmlBody: `<pre>${text.replace(/</g, "&lt;")}</pre>`,
      paper: "a4",
      title: `${shopName} Command Center`,
      shareDialogTitle: `${shopName} Command Center`,
    });
  }, [shopName, periodLabel, healthScore, officialFinancials, heroExpectedCash, financialReadiness, canProfit]);

  const ctx = useMemo((): DashboardCenterContext => ({
    lang,
    surface: "command-center",
    mode,
    businessType: preferences.businessType,
    can,
    canProfit,
    filter,
    setFilter,
    includeArchived,
    setIncludeArchived,
    archiveNotice,
    archivedSalesCount,
    needsArchive,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    shopName,
    periodLabel,
    commandCenter,
    cloudProtection,
    healthScore,
    domainStatuses,
    kpiCards,
    officialFinancials,
    canExportOfficialFinancials: officialFinancials.canExport,
    recommendations,
    summaryKey,
    summaryVars,
    filteredAttention,
    devicesTotal,
    devicesOnline: deviceHealth.devicesOnline,
    heroExpectedCash,
    revenueSparkline,
    comparisonLabelKey,
    onAcknowledge,
    exportDashboard,
    shareDashboard,
    printDashboard,
    recommendationsSectionId: RECOMMENDATIONS_SECTION_ID,
    hospitalityStats,
    hospitalityFloor,
  }), [
    lang,
    mode,
    preferences.businessType,
    can,
    canProfit,
    filter,
    setFilter,
    includeArchived,
    setIncludeArchived,
    archiveNotice,
    archivedSalesCount,
    needsArchive,
    searchOpen,
    searchQuery,
    shopName,
    periodLabel,
    commandCenter,
    cloudProtection,
    healthScore,
    domainStatuses,
    kpiCards,
    officialFinancials,
    recommendations,
    summaryKey,
    summaryVars,
    filteredAttention,
    devicesTotal,
    deviceHealth.devicesOnline,
    heroExpectedCash,
    revenueSparkline,
    comparisonLabelKey,
    onAcknowledge,
    exportDashboard,
    shareDashboard,
    printDashboard,
    hospitalityStats,
    hospitalityFloor,
  ]);

  return <EnterpriseDashboardShell ctx={ctx} />;
}
