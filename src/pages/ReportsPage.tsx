import { actorHasPermission } from "../lib/actorAuthorization";
import { useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useReportingSales } from "../hooks/useReportingSales";
import { useReportingReturnRecords } from "../hooks/useReportingReturnRecords";
import { useShopReportBundle } from "../hooks/useShopReporting";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { dateKeyKampala } from "../lib/datesUg";
import { DateFilterArchiveNotice } from "../components/shared/DateFilterArchiveNotice";
import { MONTH_TO_DATE_FILTER } from "../lib/dateFilters";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { formatDateFilterViewingLabel, isSingleDayFilter, selectedDayKeyForFilter } from "../lib/dateFilterLabels";
import { useSessionActor } from "../context/SessionActorContext";

import { useSubscription } from "../context/SubscriptionContext";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { buildDailyReportText, shareText } from "../lib/reportExport";
import { downloadDailyReportPdf } from "../lib/dailyReportPdf";
import { printHtmlDocument } from "../lib/documentPrint";
import { PageHeader } from "../components/layout/PageHeader";
import { computeHospitalityReports } from "../lib/hospitalityReports";
import { isHospitalityMode, totalOpenTablesPendingUgx } from "../lib/hospitality";
import { activeSessions } from "../lib/hospitalityStats";
import { computePharmacyExpiryReport } from "../lib/pharmacyReports";
import { isPharmacyMode } from "../lib/pharmacy";
import { isWholesaleMode } from "../lib/wholesale";
import { AnalyticsKpiGrid } from "../features/business-analytics/components/AnalyticsKpiGrid";
import { AnalyticsCategoryChips } from "../features/business-analytics/components/AnalyticsCategoryChips";
import { AnalyticsPageToolbar } from "../features/business-analytics/components/AnalyticsPageToolbar";
import { AnalyticsDateFilterSheet } from "../features/business-analytics/components/AnalyticsDateFilterSheet";
import { AnalyticsExportFab, AnalyticsExportSheet } from "../features/business-analytics/components/AnalyticsExportSheet";
import { AnalyticsAiInsights } from "../features/business-analytics/components/AnalyticsAiInsights";
import { AnalyticsCategoryContent } from "../features/business-analytics/components/AnalyticsCategoryContent";
import { AnalyticsModeReports } from "../features/business-analytics/components/AnalyticsModeReports";
import { useBusinessAnalyticsCategory } from "../features/business-analytics/hooks/useBusinessAnalyticsCategory";
import type { AnalyticsCategory, AnalyticsKpiId } from "../features/business-analytics/types";
import {
  buildAiInsights,
  buildAnalyticsKpiCards,
  computeRangeAnalytics,
  computeTopCashiers,
  customerLeaderboard,
  kpiCategoryForId,
  productLeaderboard,
} from "../features/business-analytics/lib/analyticsPageView";
import { buildSoldByNameByUserId } from "../lib/soldByLabels";

export function ReportsPage({ lang }: { lang: Language }) {
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

  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const wholesaleMode = isWholesaleMode(preferences.businessType);

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
    if (!pharmacyMode) return null;
    return computePharmacyExpiryReport(products);
  }, [pharmacyMode, products]);

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

  const pageTitle = wholesaleMode
    ? t(lang, "wholesaleReportsHubTitle")
    : pharmacyMode
      ? t(lang, "pharmacyReportsHubTitle")
      : t(lang, "baPageTitle");

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

  if (!canViewReports) {
    return <Navigate to="/" replace />;
  }

  const handleKpiSelect = (id: AnalyticsKpiId) => {
    setActiveKpi((cur) => (cur === id ? null : id));
    setCategory(kpiCategoryForId(id) as AnalyticsCategory);
  };

  const legacyTabCleanup = () => {
    if (searchParams.has("tab")) {
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <div className="min-w-0 max-w-full space-y-4 enterprise-page">
      <PageHeader lang={lang} title={pageTitle} subtitle={t(lang, "baPageSub")} backLabel={t(lang, "officeBackToHub")} />

      <AnalyticsPageToolbar
        lang={lang}
        periodLabel={periodLabel}
        compareEnabled={compareEnabled}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenDateFilter={() => setDateOpen(true)}
        onToggleCompare={() => setCompareEnabled((v) => !v)}
        onOpenFilters={() => setDateOpen(true)}
        onOpenExport={() => setExportOpen(true)}
      />

      <AnalyticsKpiGrid
        lang={lang}
        cards={kpiCards}
        activeId={activeKpi}
        compareLabel={compareEnabled ? t(lang, "baComparePrior") : null}
        onSelect={handleKpiSelect}
      />

      <AnalyticsAiInsights lang={lang} insights={aiInsights} />

      {archiveNotice ? (
        <DateFilterArchiveNotice lang={lang} archivedCount={archivedSalesCount} onEnableArchived={() => setIncludeArchived(true)} />
      ) : null}
      {needsArchive && includeArchived && archivedSalesCount > 0 ? (
        <p className="text-xs font-semibold text-stone-600">{t(lang, "dateFilterArchiveIncluded")}</p>
      ) : null}

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      <AnalyticsCategoryChips
        lang={lang}
        active={category}
        canProfit={canProfit}
        onChange={(c) => {
          legacyTabCleanup();
          setCategory(c);
        }}
      />

      {reportHint ? <p className="text-sm font-medium text-stone-600">{reportHint}</p> : null}

      <AnalyticsCategoryContent
        lang={lang}
        category={category}
        report={report}
        canProfit={canProfit}
        paymentMix={analytics.paymentMix}
        trendBars={analytics.trendBars}
        sparkline={analytics.sparkline}
        topProducts={topProducts}
        topCustomers={topCustomers}
        topCashiers={topCashiers}
        inventory={analytics.inventory}
        expensesUgx={analytics.expensesUgx}
        debtOutstanding={report.debtOutstanding}
        supplierDebtTotal={report.supplierDebtTotal}
        stockValueAtCost={report.stockValueAtCost}
        purchasesTodayUgx={purchasesTodayUgx}
        marginLeaders={marginLeaders}
        weakProducts={report.slowProducts}
        products={products}
        purchases={purchases}
        suppliers={suppliers}
        count={report.count}
        revenue={report.revenue}
        profit={report.profit}
        modePanels={
          category === "overview" ? (
            <AnalyticsModeReports
              lang={lang}
              products={products}
              stockMovements={stockMovements}
              pharmacyMode={pharmacyMode}
              wholesaleMode={wholesaleMode}
              pharmacyExpiryReport={pharmacyExpiryReport}
              wholesaleSection={
                wholesaleMode
                  ? {
                      debtOutstanding: report.debtOutstanding,
                      count: report.count,
                      stockValueAtCost: report.stockValueAtCost,
                      customers,
                    }
                  : null
              }
              hospitalityReports={hospitalityReports}
              hospitalityOpenBills={hospitalityOpenBills}
              hospitalityFloor={preferences.hospitalityFloor}
            />
          ) : null
        }
      />

      <AnalyticsDateFilterSheet
        lang={lang}
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        currentFilter={filter}
        onApply={(next) => {
          setFilter(next);
          legacyTabCleanup();
        }}
      />

      <AnalyticsExportSheet
        lang={lang}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onExportPdf={() => {
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
        }}
        onExportCsv={() => {
          void navigator.clipboard.writeText(exportSummaryText);
          setReportHint(t(lang, "reportCopied"));
        }}
        onExportExcel={() => {
          void navigator.clipboard.writeText(exportSummaryText);
          setReportHint(t(lang, "reportCopied"));
        }}
        onPrint={() => {
          printHtmlDocument(
            `<pre style="font-family:system-ui;white-space:pre-wrap">${exportSummaryText.replace(/</g, "&lt;")}</pre>`,
            "80mm",
            pageTitle,
          );
        }}
        onShare={() => void shareText(exportSummaryText, pageTitle)}
        onCopy={() => {
          void navigator.clipboard.writeText(exportSummaryText);
          setReportHint(t(lang, "reportCopied"));
        }}
      />

      <AnalyticsExportFab lang={lang} onClick={() => setExportOpen(true)} />
    </div>
  );
}
