import { useCallback, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { actorHasPermission } from "../../lib/actorAuthorization";
import { usePosStore } from "../../store/usePosStore";
import { useReportingSales } from "../../hooks/useReportingSales";
import { useReportingReturnRecords } from "../../hooks/useReportingReturnRecords";
import { useShopReportBundle } from "../../hooks/useShopReporting";
import { dateKeyKampala } from "../../lib/datesUg";
import { MONTH_TO_DATE_FILTER } from "../../lib/dateFilters";
import { useReportingDateFilter } from "../../hooks/useReportingDateFilter";
import { formatDateFilterViewingLabel, isSingleDayFilter, selectedDayKeyForFilter } from "../../lib/dateFilterLabels";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { resolveProfitVisibility } from "../../lib/profitVisibility";
import { buildDailyReportText, shareText } from "../../lib/reportExport";
import { downloadDailyReportPdf } from "../../lib/dailyReportPdf";
import { printHtmlDocument } from "../../lib/documentPrint";
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
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
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
  const { canProfit } = resolveProfitVisibility({ role: actor.role, snapshot, authMode, actorPermissions: actor.permissions });

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
      ),
    [sales, products, customers, returnRecords, suppliers, filter, cashExpenses, compareEnabled],
  );

  const reportDayKey = selectedDayKeyForFilter(filter) ?? dateKeyKampala(new Date());
  const showDailyExport = isSingleDayFilter(filter);
  const periodLabel = useMemo(() => formatDateFilterViewingLabel(lang, filter), [filter, lang]);
  const pageTitle = useMemo(() => resolveReportsPageTitle(lang, mode), [lang, mode]);

  const purchasesTodayUgx = useMemo(() => {
    return purchases.filter((p) => dateKeyKampala(p.createdAt) === reportDayKey).reduce((a, p) => a + p.totalCostUgx, 0);
  }, [purchases, reportDayKey]);

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

  const kpiCards = useMemo(
    () =>
      buildAnalyticsKpiCards({
        revenue: report.revenue,
        profit: report.profit,
        count: report.count,
        customerCount: analytics.customerCount,
        debtOutstanding: report.debtOutstanding,
        canProfit,
        compareEnabled,
        priorRevenue: analytics.prior?.summary.totalRevenueUgx ?? 0,
        priorProfit: analytics.prior?.profitUgx ?? 0,
        priorCount: analytics.prior?.summary.transactionCount ?? 0,
        priorCustomers: analytics.priorCustomerCount,
        priorDebt: analytics.prior?.customers.totalDebtOutstandingUgx ?? report.debtOutstanding,
        sparkline: analytics.sparkline,
      }),
    [report, analytics, canProfit, compareEnabled],
  );

  const aiInsights = useMemo(
    () =>
      buildAiInsights({
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
      }),
    [report, analytics, canProfit],
  );

  const soldByNameByUserId = useMemo(
    () =>
      buildSoldByNameByUserId({
        staffAccounts: preferences.staffAccounts,
        shifts,
        auditLogs,
        ownerUserId: actor.userId.startsWith("staff:") ? null : actor.userId,
        ownerDisplayName: actor.displayName,
        shopDisplayName: preferences.shopDisplayName,
      }),
    [preferences.staffAccounts, preferences.shopDisplayName, shifts, auditLogs, actor.userId, actor.displayName],
  );

  const topProducts = useMemo(() => productLeaderboard(report.topProducts, "revenue"), [report.topProducts]);
  const topCustomers = useMemo(() => customerLeaderboard(customers, sales, filter), [customers, sales, filter]);
  const topCashiers = useMemo(
    () =>
      computeTopCashiers(sales, analytics.bounds, {
        lang,
        nameByUserId: soldByNameByUserId,
        shopDisplayName: preferences.shopDisplayName,
      }),
    [sales, analytics.bounds, lang, soldByNameByUserId, preferences.shopDisplayName],
  );

  const exportSummaryText = useMemo(() => {
    if (!showDailyExport) {
      return [
        pageTitle,
        periodLabel,
        `${t(lang, "receiptsRangeRevenue")}: UGX ${report.revenue.toLocaleString()}`,
        `${t(lang, "salesCount")}: ${report.count}`,
        canProfit ? `${t(lang, "estimatedProfit")}: UGX ${report.profit.toLocaleString()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
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
      includeProfit: canProfit,
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

  const onExportPdf = useCallback(() => {
    if (showDailyExport) {
      void downloadDailyReportPdf({
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
        topProducts: report.topProducts,
        includeProfit: canProfit,
      }).then((ok) => setReportHint(ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail")));
    } else {
      setReportHint(t(lang, "baExportDailyOnly"));
    }
  }, [
    showDailyExport,
    lang,
    reportDayKey,
    preferences.shopDisplayName,
    sales,
    products,
    returnRecords,
    debtPayments,
    cashExpenses,
    supplierPayments,
    cashDrawerAdjustments,
    shifts,
    report.topProducts,
    canProfit,
  ]);

  const onExportCsv = useCallback(() => {
    void navigator.clipboard.writeText(exportSummaryText);
    setReportHint(t(lang, "reportCopied"));
  }, [exportSummaryText, lang]);

  const onExportExcel = useCallback(() => {
    void navigator.clipboard.writeText(exportSummaryText);
    setReportHint(t(lang, "reportCopied"));
  }, [exportSummaryText, lang]);

  const onPrint = useCallback(() => {
    printHtmlDocument(
      `<pre style="font-family:system-ui;white-space:pre-wrap">${exportSummaryText.replace(/</g, "&lt;")}</pre>`,
      "80mm",
      pageTitle,
    );
  }, [exportSummaryText, pageTitle]);

  const onShare = useCallback(() => {
    void shareText(exportSummaryText, pageTitle);
  }, [exportSummaryText, pageTitle]);

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(exportSummaryText);
    setReportHint(t(lang, "reportCopied"));
  }, [exportSummaryText, lang]);

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
