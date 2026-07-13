import { PageHeader } from "../../../components/layout/PageHeader";
import { IncludeArchivedFilter } from "../../../components/office/IncludeArchivedFilter";
import { DateFilterArchiveNotice } from "../../../components/shared/DateFilterArchiveNotice";
import { t } from "../../../lib/i18n";
import { AnalyticsAiInsights } from "../components/AnalyticsAiInsights";
import { AnalyticsCategoryChips } from "../components/AnalyticsCategoryChips";
import { AnalyticsCategoryContent } from "../components/AnalyticsCategoryContent";
import { AnalyticsDateFilterSheet } from "../components/AnalyticsDateFilterSheet";
import { AnalyticsExportFab, AnalyticsExportSheet } from "../components/AnalyticsExportSheet";
import { AnalyticsKpiGrid } from "../components/AnalyticsKpiGrid";
import { AnalyticsPageToolbar } from "../components/AnalyticsPageToolbar";
import { renderReportWidgets } from "./enterpriseReportsRegistry";
import type { ReportWidgetDef, ReportWidgetProps } from "./reportWidgetTypes";

function HeaderWidget({ ctx }: ReportWidgetProps) {
  return (
    <PageHeader
      lang={ctx.lang}
      title={ctx.pageTitle}
      subtitle={t(ctx.lang, "baPageSub")}
      backLabel={t(ctx.lang, "officeBackToHub")}
    />
  );
}

function ToolbarWidget({ ctx }: ReportWidgetProps) {
  return (
    <AnalyticsPageToolbar
      lang={ctx.lang}
      periodLabel={ctx.periodLabel}
      compareEnabled={ctx.compareEnabled}
      searchQuery={ctx.searchQuery}
      onSearchChange={ctx.setSearchQuery}
      onOpenDateFilter={() => ctx.setDateOpen(true)}
      onToggleCompare={() => ctx.setCompareEnabled((v) => !v)}
      onOpenFilters={() => ctx.setDateOpen(true)}
      onOpenExport={() => ctx.setExportOpen(true)}
    />
  );
}

function KpiGridWidget({ ctx }: ReportWidgetProps) {
  return (
    <AnalyticsKpiGrid
      lang={ctx.lang}
      cards={ctx.kpiCards}
      activeId={ctx.activeKpi}
      compareLabel={ctx.compareEnabled ? t(ctx.lang, "baComparePrior") : null}
      onSelect={ctx.handleKpiSelect}
    />
  );
}

function AiInsightsWidget({ ctx }: ReportWidgetProps) {
  return <AnalyticsAiInsights lang={ctx.lang} insights={ctx.aiInsights} />;
}

function ArchiveStatusWidget({ ctx }: ReportWidgetProps) {
  return (
    <>
      {ctx.archiveNotice ? (
        <DateFilterArchiveNotice
          lang={ctx.lang}
          archivedCount={ctx.archivedSalesCount}
          onEnableArchived={() => ctx.setIncludeArchived(true)}
        />
      ) : null}
      {ctx.needsArchive && ctx.includeArchived && ctx.archivedSalesCount > 0 ? (
        <p className="text-xs font-semibold text-muted-foreground">{t(ctx.lang, "dateFilterArchiveIncluded")}</p>
      ) : null}
    </>
  );
}

function IncludeArchivedWidget({ ctx }: ReportWidgetProps) {
  return (
    <IncludeArchivedFilter lang={ctx.lang} checked={ctx.includeArchived} onChange={ctx.setIncludeArchived} />
  );
}

function CategoryFiltersWidget({ ctx }: ReportWidgetProps) {
  return (
    <AnalyticsCategoryChips
      lang={ctx.lang}
      active={ctx.category}
      canProfit={ctx.canProfit}
      onChange={(c) => {
        ctx.legacyTabCleanup();
        ctx.setCategory(c);
      }}
    />
  );
}

function ReportHintWidget({ ctx }: ReportWidgetProps) {
  if (!ctx.reportHint) return null;
  return <p className="text-sm font-medium text-muted-foreground">{ctx.reportHint}</p>;
}

function CategoryContentWidget({ ctx }: ReportWidgetProps) {
  const modePanels = renderReportWidgets("operations", ctx);
  return (
    <AnalyticsCategoryContent
      lang={ctx.lang}
      category={ctx.category}
      report={ctx.report}
      canProfit={ctx.canProfit}
      paymentMix={ctx.analytics.paymentMix}
      trendBars={ctx.analytics.trendBars}
      sparkline={ctx.analytics.sparkline}
      topProducts={ctx.topProducts}
      topCustomers={ctx.topCustomers}
      topCashiers={ctx.topCashiers}
      inventory={ctx.analytics.inventory}
      expensesUgx={ctx.analytics.expensesUgx}
      debtOutstanding={ctx.report.debtOutstanding}
      supplierDebtTotal={ctx.report.supplierDebtTotal}
      stockValueAtCost={ctx.report.stockValueAtCost}
      purchasesTodayUgx={ctx.purchasesTodayUgx}
      purchasesInPeriodUgx={ctx.purchasesInPeriodUgx}
      marginLeaders={ctx.marginLeaders}
      weakProducts={ctx.report.slowProducts}
      products={ctx.products}
      purchases={ctx.purchases}
      suppliers={ctx.suppliers}
      count={ctx.report.count}
      revenue={ctx.report.revenue}
      profit={ctx.report.profit}
      modePanels={modePanels}
    />
  );
}

function FooterSheetsWidget({ ctx }: ReportWidgetProps) {
  return (
    <>
      <AnalyticsDateFilterSheet
        lang={ctx.lang}
        open={ctx.dateOpen}
        onClose={() => ctx.setDateOpen(false)}
        currentFilter={ctx.filter}
        onApply={(next) => {
          ctx.setFilter(next);
          ctx.legacyTabCleanup();
        }}
      />

      <AnalyticsExportSheet
        lang={ctx.lang}
        open={ctx.exportOpen}
        onClose={() => ctx.setExportOpen(false)}
        onExportPdf={ctx.onExportPdf}
        onExportCsv={ctx.onExportCsv}
        onExportExcel={ctx.onExportExcel}
        onPrint={ctx.onPrint}
        onShare={ctx.onShare}
        onCopy={ctx.onCopy}
      />
    </>
  );
}

function ExportFabWidget({ ctx }: ReportWidgetProps) {
  return <AnalyticsExportFab lang={ctx.lang} onClick={() => ctx.setExportOpen(true)} />;
}

/** Shared enterprise report widgets — available to every business mode. */
export const RETAIL_REPORT_WIDGETS: ReportWidgetDef[] = [
  { id: "retail-header", slot: "header", priority: 100, businessTypes: "*", Component: HeaderWidget },
  { id: "retail-toolbar", slot: "search", priority: 100, businessTypes: "*", Component: ToolbarWidget },
  { id: "retail-kpi-grid", slot: "overview-kpis", priority: 100, businessTypes: "*", Component: KpiGridWidget },
  { id: "retail-ai-insights", slot: "charts", priority: 100, businessTypes: "*", Component: AiInsightsWidget },
  { id: "retail-archive-status", slot: "status", priority: 100, businessTypes: "*", Component: ArchiveStatusWidget },
  { id: "retail-include-archived", slot: "status", priority: 200, businessTypes: "*", Component: IncludeArchivedWidget },
  { id: "retail-category-filters", slot: "filters", priority: 100, businessTypes: "*", Component: CategoryFiltersWidget },
  { id: "retail-report-hint", slot: "status", priority: 300, businessTypes: "*", Component: ReportHintWidget },
  { id: "retail-category-content", slot: "reports", priority: 100, businessTypes: "*", Component: CategoryContentWidget },
  { id: "retail-footer-sheets", slot: "footer", priority: 100, businessTypes: "*", Component: FooterSheetsWidget },
  { id: "retail-export-fab", slot: "exports", priority: 100, businessTypes: "*", Component: ExportFabWidget },
];
