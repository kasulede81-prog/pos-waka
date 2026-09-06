import { useCallback, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { actorHasPermission } from "../../lib/actorAuthorization";
import { usePosStore } from "../../store/usePosStore";
import { useReportingSales } from "../../hooks/useReportingSales";
import { useReportingReturnRecords } from "../../hooks/useReportingReturnRecords";
import { useDayClosesForAuthority } from "../../hooks/useDayClosesForAuthority";
import { useShopReportBundle } from "../../hooks/useShopReporting";
import { dateKeyKampala } from "../../lib/datesUg";
import { MONTH_TO_DATE_FILTER } from "../../lib/dateFilters";
import { useReportingDateFilter } from "../../hooks/useReportingDateFilter";
import { formatDateFilterViewingLabel, isSingleDayFilter, selectedDayKeyForFilter } from "../../lib/dateFilterLabels";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { resolveProfitVisibility } from "../../lib/profitVisibility";
import { authOperatorPermissions, authOperatorRole } from "../../lib/sessionActor";
import { buildDailyReportText, shareText } from "../../lib/reportExport";
import { downloadDailyReportPdf, printDailyReportPdf, shareDailyReportPdf } from "../../lib/dailyReportPdf";
import { canExportReportsData, runReportsExportIfComplete } from "../../lib/reportsDataCompleteness";
import { resolveCashDrawerFormulaVersion } from "../../lib/dayDrawerOpen";
import { statusFromAuthority, ugxLabel, type ReportDocumentModel } from "../../lib/reportDocumentModel";
import { printReportDocumentModel } from "../../lib/reportDocumentPrint";
import { buildAnalyticsReportRows } from "../../lib/analyticsReportExport";
import { computeReportsPeriodCashFlow } from "../../lib/reportsCashFlow";
import { exportCsvFile, exportXlsxFile } from "../../lib/reportExportEngine";
import { sumPurchasesForReporting } from "../../lib/purchaseReporting";
import { computeHospitalityReports } from "../../lib/hospitalityReports";
import { isHospitalityMode, totalOpenTablesPendingUgx } from "../../lib/hospitality";
import { activeSessions } from "../../lib/hospitalityStats";
import { computePharmacyExpiryReport } from "../../lib/pharmacyReports";
import { useBusinessAnalyticsCategory } from "./hooks/useBusinessAnalyticsCategory";
import type { AnalyticsCategory, AnalyticsKpiId } from "./types";
import {
  buildAiInsights,
  buildAnalyticsKpiCards,
  computeRangeAnalytics,
  computeTopCashiers,
  customerLeaderboard,
  kpiCategoryForId,
  productLeaderboard,
} from "./lib/analyticsPageView";
import { presentReportsKpiSparkline } from "./lib/reportsKpiSparklineContext";
import { buildSoldByNameByUserId } from "../../lib/soldByLabels";
import { createReportSlotRenderer } from "./registry/enterpriseReportsRegistry";
import { resolveReportsPageTitle } from "./registry/reportsCatalog";
import { resolveReportsMode } from "./registry/reportsMode";
import type { ReportsCenterContext } from "./registry/reportWidgetTypes";

export function EnterpriseReportsShell({ lang }: { lang: Language }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const purchases = usePosStore((s) => s.purchases);
  const suppliers = usePosStore((s) => s.suppliers);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const dayCloses = useDayClosesForAuthority();
  const preferences = usePosStore((s) => s.preferences);
  const auditLogs = usePosStore((s) => s.auditLogs);
  const stockMovements = usePosStore((s) => s.stockMovements);

  const mode = resolveReportsMode(preferences.businessType, preferences.pharmacyModeEnabled);

  const {
    filter,
    setFilter,
    bounds,
    includeArchived,
    setIncludeArchived,
    archiveNotice,
    archivedSalesCount,
    needsArchive,
  } = useReportingDateFilter(MONTH_TO_DATE_FILTER);
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [activeKpi, setActiveKpi] = useState<AnalyticsKpiId | null>(null);
  const [reportHint, setReportHint] = useState<string | null>(null);

  const sales = useReportingSales(includeArchived);
  const returnRecords = useReportingReturnRecords(includeArchived);
  const report = useShopReportBundle(filter, includeArchived);
  const { category, setCategory } = useBusinessAnalyticsCategory();

  const can = useCallback((perm: Parameters<typeof actorHasPermission>[1]) => actorHasPermission(actor, perm), [actor]);
  const canViewReports = actorHasPermission(actor, "reports.view");
  const { canProfit } = resolveProfitVisibility({
    role: authOperatorRole(actor),
    snapshot,
    authMode,
    actorPermissions: authOperatorPermissions(actor),
  });

  const analytics = useMemo(
    () =>
      computeRangeAnalytics(
        sales,
        products,
        customers,
        returnRecords,
        suppliers,
        filter,
        cashExpenses,
        compareEnabled,
        dayCloses,
      ),
    [sales, products, customers, returnRecords, suppliers, filter, cashExpenses, compareEnabled, dayCloses],
  );

  const reportDayKey = selectedDayKeyForFilter(filter) ?? dateKeyKampala(new Date());
  const showDailyExport = isSingleDayFilter(filter);
  const periodLabel = useMemo(() => formatDateFilterViewingLabel(lang, filter), [filter, lang]);
  const pageTitle = useMemo(() => resolveReportsPageTitle(lang, mode), [lang, mode]);

  const purchasesInPeriodUgx = useMemo(() => sumPurchasesForReporting(purchases, bounds).totalUgx, [purchases, bounds]);

  const cashFlow = useMemo(
    () =>
      computeReportsPeriodCashFlow({
        sales,
        returns: returnRecords,
        products,
        debtPayments,
        cashExpenses,
        supplierPayments,
        cashDrawerAdjustments,
        shifts,
        dayDrawerOpens,
        formulaVersion: resolveCashDrawerFormulaVersion(preferences),
        dayCloses,
        bounds,
      }),
    [
      sales,
      returnRecords,
      products,
      debtPayments,
      cashExpenses,
      supplierPayments,
      cashDrawerAdjustments,
      shifts,
      dayDrawerOpens,
      preferences,
      dayCloses,
      bounds,
    ],
  );

  const purchasesTodayUgx = useMemo(
    () =>
      sumPurchasesForReporting(purchases, { fromKey: reportDayKey, toKey: reportDayKey, isSingleDay: true }).totalUgx,
    [purchases, reportDayKey],
  );

  const hospitalityReports = useMemo(() => {
    if (!isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) return null;
    return computeHospitalityReports(sales, products, { fromKey: bounds.fromKey, toKey: bounds.toKey }, {
      floor: preferences.hospitalityFloor,
      staffAccounts: preferences.staffAccounts,
    });
  }, [preferences, bounds, sales, products]);

  const hospitalityOpenBills = useMemo(() => {
    if (!hospitalityReports || !preferences.hospitalityFloor) return null;
    const open = activeSessions(preferences.hospitalityFloor);
    return { count: open.length, totalUgx: totalOpenTablesPendingUgx(sales, preferences.hospitalityFloor) };
  }, [hospitalityReports, preferences.hospitalityFloor, sales]);

  const pharmacyExpiryReport = useMemo(() => {
    if (mode !== "pharmacy") return null;
    return computePharmacyExpiryReport(products);
  }, [mode, products]);

  const wholesaleSection = useMemo(() => {
    if (mode !== "wholesale") return null;
    return {
      debtOutstanding: report.debtOutstanding,
      count: report.count,
      stockValueAtCost: report.stockValueAtCost,
      customers,
    };
  }, [mode, report.debtOutstanding, report.count, report.stockValueAtCost, customers]);

  const marginLeaders = useMemo(
    () =>
      report.marginLeaders.map((r) => ({
        name: r.name,
        revenue: r.revenueUgx,
        profit: r.profitUgx,
        pct: r.revenueUgx > 0 ? r.profitUgx / r.revenueUgx : 0,
      })),
    [report.marginLeaders],
  );

  const kpiCards = useMemo(() => {
    if (report.loading) return [];
    const liveReady = report.dataComplete;
    return buildAnalyticsKpiCards({
      revenue: report.revenue,
      profit: report.profit,
      count: report.count,
      customerCount: liveReady ? analytics.customerCount : 0,
      debtOutstanding: report.debtOutstanding,
      canProfit,
      compareEnabled: liveReady && compareEnabled,
      priorRevenue: liveReady ? (analytics.prior?.summary.totalRevenueUgx ?? 0) : 0,
      priorProfit: liveReady ? (analytics.prior?.profitUgx ?? 0) : 0,
      priorCount: liveReady ? (analytics.prior?.summary.transactionCount ?? 0) : 0,
      priorCustomers: liveReady ? analytics.priorCustomerCount : 0,
      priorDebt: liveReady ? (analytics.prior?.customers.totalDebtOutstandingUgx ?? report.debtOutstanding) : report.debtOutstanding,
      sparkline: presentReportsKpiSparkline(liveReady ? analytics.sparkline : [], {
        dataComplete: liveReady,
        closedDayBreakdownUnavailable: analytics.closedDayBreakdownUnavailable,
        selectedBounds: bounds,
      }),
    });
  }, [report, analytics, canProfit, compareEnabled, bounds]);

  const aiInsights = useMemo(() => {
    if (!report.dataComplete) return [];
    return buildAiInsights({
      revenue: report.revenue,
      profit: report.profit,
      priorRevenue: analytics.prior?.summary.totalRevenueUgx ?? 0,
      priorProfit: analytics.prior?.profitUgx ?? 0,
      topProduct: report.topProducts[0],
      inventoryValue: analytics.inventory.stockValueAtCostUgx,
      lowStockCount: analytics.inventory.lowStock.length,
      lowStockProduct: analytics.inventory.lowStock[0]?.name,
      customerCount: analytics.customerCount,
      priorCustomerCount: analytics.priorCustomerCount,
      canProfit,
    });
  }, [report, analytics, canProfit]);

  const soldByNameByUserId = useMemo(
    () =>
      buildSoldByNameByUserId({
        staffAccounts: preferences.staffAccounts,
        shifts,
        auditLogs,
        ownerUserId: actor.authUserId ?? (actor.userId.startsWith("staff:") ? null : actor.userId),
        ownerDisplayName: actor.displayName,
        shopDisplayName: preferences.shopDisplayName,
      }),
    [preferences.staffAccounts, preferences.shopDisplayName, shifts, auditLogs, actor.authUserId, actor.userId, actor.displayName],
  );

  const searchNeedle = searchQuery.trim().toLowerCase();

  const topProducts = useMemo(() => {
    if (report.closedDayBreakdownUnavailable) return [];
    const rows = productLeaderboard(report.topProducts, "revenue");
    if (!searchNeedle) return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(searchNeedle));
  }, [report.closedDayBreakdownUnavailable, report.topProducts, searchNeedle]);

  const topCustomers = useMemo(() => {
    if (report.closedDayBreakdownUnavailable) return [];
    const rows = customerLeaderboard(customers, sales, filter);
    if (!searchNeedle) return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(searchNeedle));
  }, [report.closedDayBreakdownUnavailable, customers, sales, filter, searchNeedle]);

  const topCashiers = useMemo(
    () => {
      if (report.closedDayBreakdownUnavailable) return [];
      const rows = computeTopCashiers(sales, analytics.bounds, {
        lang,
        nameByUserId: soldByNameByUserId,
        shopDisplayName: preferences.shopDisplayName,
      });
      if (!searchNeedle) return rows;
      return rows.filter((r) => r.label.toLowerCase().includes(searchNeedle));
    },
    [report.closedDayBreakdownUnavailable, sales, analytics.bounds, lang, soldByNameByUserId, preferences.shopDisplayName, searchNeedle],
  );

  const exportSummaryText = useMemo(() => {
    if (!showDailyExport) {
      const lines = [
        pageTitle,
        periodLabel,
        `${t(lang, "receiptsRangeRevenue")}: UGX ${report.revenue.toLocaleString()}`,
        `${t(lang, "salesCount")}: ${report.count}`,
        canProfit ? `${t(lang, "estimatedProfit")}: UGX ${report.profit.toLocaleString()}` : "",
      ].filter(Boolean);
      if (report.authority !== "live") {
        lines.push(t(lang, "dailyReportClosedAuthorityNote"));
      }
      return lines.join("\n");
    }
    return buildDailyReportText(lang, reportDayKey, {
      sales,
      products,
      returnRecords,
      debtPayments,
      cashExpenses,
      supplierPayments,
      cashDrawerAdjustments,
      shifts,
      dayDrawerOpens,
      formulaVersion: resolveCashDrawerFormulaVersion(preferences),
      includeProfit: canProfit,
      dayCloses,
    });
  }, [
    showDailyExport,
    pageTitle,
    periodLabel,
    report,
    canProfit,
    lang,
    reportDayKey,
    sales,
    products,
    returnRecords,
    debtPayments,
    cashExpenses,
    supplierPayments,
    cashDrawerAdjustments,
    shifts,
    dayDrawerOpens,
    preferences,
    dayCloses,
  ]);

  const legacyTabCleanup = useCallback(() => {
    if (searchParams.has("tab")) {
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleKpiSelect = useCallback(
    (id: AnalyticsKpiId) => {
      setActiveKpi((cur) => (cur === id ? null : id));
      setCategory(kpiCategoryForId(id) as AnalyticsCategory);
    },
    [setCategory],
  );

  const dailyPdfInput = useMemo(
    () => ({
      lang,
      dateKey: reportDayKey,
      shopName: preferences.shopDisplayName?.trim() || "Waka POS",
      sales,
      products,
      returnRecords,
      debtPayments,
      cashExpenses,
      supplierPayments,
      cashDrawerAdjustments,
      shifts,
      dayDrawerOpens,
      formulaVersion: resolveCashDrawerFormulaVersion(preferences),
      topProducts: report.topProducts,
      includeProfit: canProfit,
      dayCloses,
    }),
    [
      lang,
      reportDayKey,
      preferences,
      sales,
      products,
      returnRecords,
      debtPayments,
      cashExpenses,
      supplierPayments,
      cashDrawerAdjustments,
      shifts,
      dayDrawerOpens,
      report.topProducts,
      canProfit,
      dayCloses,
    ],
  );

  const onExportPdf = useCallback(() => {
    if (!canExportReportsData(report)) {
      setReportHint(t(lang, "baReportExportNotReady"));
      return;
    }
    if (showDailyExport) {
      void downloadDailyReportPdf(dailyPdfInput).then((ok) =>
        setReportHint(ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail")),
      );
    } else {
      setReportHint(t(lang, "baExportDailyOnly"));
    }
  }, [showDailyExport, dailyPdfInput, lang, report]);

  const analyticsExportRows = useMemo(
    () =>
      buildAnalyticsReportRows({
        lang,
        title: pageTitle,
        periodLabel,
        report,
        expensesUgx: analytics.expensesUgx,
        purchasesInPeriodUgx,
        cashFlow,
        canProfit,
      }),
    [lang, pageTitle, periodLabel, report, analytics.expensesUgx, purchasesInPeriodUgx, cashFlow, canProfit],
  );

  const onExportCsv = useCallback(async () => {
    const rows = runReportsExportIfComplete(report.dataComplete, () => analyticsExportRows);
    if (!rows) {
      setReportHint(t(lang, "baReportExportNotReady"));
      return;
    }
    const result = await exportCsvFile(
      "reports",
      `waka-report-${dateKeyKampala(new Date())}.csv`,
      rows,
      { shareDialogTitle: pageTitle },
    );
    setReportHint(result.ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail"));
  }, [analyticsExportRows, lang, pageTitle, report.dataComplete]);

  const onExportExcel = useCallback(async () => {
    const rows = runReportsExportIfComplete(report.dataComplete, () => analyticsExportRows);
    if (!rows) {
      setReportHint(t(lang, "baReportExportNotReady"));
      return;
    }
    const result = await exportXlsxFile(
      "reports",
      `waka-report-${dateKeyKampala(new Date())}.xlsx`,
      rows,
      { shareDialogTitle: pageTitle, sheetName: "Report" },
    );
    setReportHint(result.ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail"));
  }, [analyticsExportRows, lang, pageTitle, report.dataComplete]);

  const onPrint = useCallback(async () => {
    if (!canExportReportsData(report)) {
      setReportHint(t(lang, "baReportExportNotReady"));
      return;
    }
    let ok = false;
    if (showDailyExport) {
      ok = await printDailyReportPdf(dailyPdfInput);
    } else {
      const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
      const model: ReportDocumentModel = {
        kind: "daily",
        lang,
        shopName,
        title: pageTitle,
        periodLabel,
        status: statusFromAuthority(report.authority, false),
        generatedAtIso: new Date().toISOString(),
        empty: report.count === 0 && report.revenue === 0,
        sections: [
          {
            title: report.authority !== "live" ? t(lang, "reportDocClosedHeadlines") : undefined,
            rows: [
              { label: t(lang, "receiptsRangeRevenue"), value: ugxLabel(report.revenue), bold: true },
              { label: t(lang, "salesCount"), value: String(report.count) },
              ...(canProfit ? [{ label: t(lang, "estimatedProfit"), value: ugxLabel(report.profit) }] : []),
            ],
          },
        ],
      };
      ok = await printReportDocumentModel("reports", `waka-report-${dateKeyKampala(new Date())}.pdf`, model, {
        title: pageTitle,
        shareDialogTitle: pageTitle,
      });
    }
    setReportHint(ok ? t(lang, "monthlyReportPrintOk") : t(lang, "monthlyReportPrintFail"));
  }, [showDailyExport, dailyPdfInput, preferences.shopDisplayName, lang, pageTitle, periodLabel, report, canProfit]);

  const onShare = useCallback(() => {
    if (!canExportReportsData(report)) {
      setReportHint(t(lang, "baReportExportNotReady"));
      return;
    }
    if (showDailyExport) {
      void shareDailyReportPdf(dailyPdfInput).then((ok) =>
        setReportHint(ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail")),
      );
      return;
    }
    void shareText(exportSummaryText, pageTitle, "reports").then((ok) =>
      setReportHint(ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail")),
    );
  }, [showDailyExport, dailyPdfInput, exportSummaryText, lang, pageTitle, report]);

  const onCopy = useCallback(() => {
    if (!canExportReportsData(report)) {
      setReportHint(t(lang, "baReportExportNotReady"));
      return;
    }
    void navigator.clipboard.writeText(exportSummaryText);
    setReportHint(t(lang, "reportCopied"));
  }, [exportSummaryText, lang, report]);

  const ctx = useMemo((): ReportsCenterContext => ({
    lang,
    mode,
    businessType: preferences.businessType,
    can,
    canProfit,
    pageTitle,
    periodLabel,
    filter,
    setFilter,
    includeArchived,
    setIncludeArchived,
    archiveNotice,
    archivedSalesCount,
    needsArchive,
    compareEnabled,
    setCompareEnabled,
    searchQuery,
    setSearchQuery,
    dateOpen,
    setDateOpen,
    exportOpen,
    setExportOpen,
    activeKpi,
    setActiveKpi,
    reportHint,
    setReportHint,
    category,
    setCategory,
    legacyTabCleanup,
    report,
    analytics,
    kpiCards,
    aiInsights,
    topProducts,
    topCustomers,
    topCashiers,
    marginLeaders,
    purchasesTodayUgx,
    purchasesInPeriodUgx,
    cashFlow,
    showDailyExport,
    reportDayKey,
    exportSummaryText,
    products,
    customers,
    purchases,
    suppliers,
    sales,
    returnRecords,
    stockMovements,
    cashExpenses,
    debtPayments,
    supplierPayments,
    cashDrawerAdjustments,
    shifts,
    preferences,
    auditLogs,
    pharmacyExpiryReport,
    hospitalityReports,
    hospitalityOpenBills,
    hospitalityFloor: preferences.hospitalityFloor,
    wholesaleSection,
    handleKpiSelect,
    onExportPdf,
    onExportCsv,
    onExportExcel,
    onPrint,
    onShare,
    onCopy,
  }), [
    lang,
    mode,
    preferences,
    can,
    canProfit,
    pageTitle,
    periodLabel,
    filter,
    includeArchived,
    archiveNotice,
    archivedSalesCount,
    needsArchive,
    compareEnabled,
    searchQuery,
    dateOpen,
    exportOpen,
    activeKpi,
    reportHint,
    category,
    setCategory,
    legacyTabCleanup,
    report,
    analytics,
    kpiCards,
    aiInsights,
    topProducts,
    topCustomers,
    topCashiers,
    marginLeaders,
    purchasesTodayUgx,
    purchasesInPeriodUgx,
    cashFlow,
    showDailyExport,
    reportDayKey,
    exportSummaryText,
    products,
    customers,
    purchases,
    suppliers,
    sales,
    returnRecords,
    stockMovements,
    cashExpenses,
    debtPayments,
    supplierPayments,
    cashDrawerAdjustments,
    shifts,
    auditLogs,
    pharmacyExpiryReport,
    hospitalityReports,
    hospitalityOpenBills,
    wholesaleSection,
    handleKpiSelect,
    onExportPdf,
    onExportCsv,
    onExportExcel,
    onPrint,
    onShare,
    onCopy,
  ]);

  const renderSlot = useMemo(() => createReportSlotRenderer(ctx), [ctx]);

  if (!canViewReports) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-w-0 max-w-full space-y-4 enterprise-page">
      {renderSlot("header")}
      {renderSlot("search")}
      {renderSlot("overview-kpis")}
      {renderSlot("charts")}
      {renderSlot("status")}
      {renderSlot("filters")}
      {renderSlot("reports")}
      {renderSlot("footer")}
      {renderSlot("exports")}
    </div>
  );
}
