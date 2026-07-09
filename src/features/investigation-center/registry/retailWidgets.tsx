import { PageHeader } from "../../../components/layout/PageHeader";
import { IncludeArchivedFilter } from "../../../components/office/IncludeArchivedFilter";
import { RefundCalculationDrawer } from "../../../components/returns/RefundCalculationDrawer";
import { actorDisplayLabel } from "../../../lib/activityNarrative";
import { t } from "../../../lib/i18n";
import { ActivityActionsSheet } from "../components/ActivityActionsSheet";
import { ActivityDetailSheet } from "../components/ActivityDetailSheet";
import { InvestigationCategoryChips } from "../components/InvestigationCategoryChips";
import { InvestigationDateFilter } from "../components/InvestigationDateFilter";
import { InvestigationExportSheet } from "../components/InvestigationExportSheet";
import { InvestigationFiltersSheet } from "../components/InvestigationFiltersSheet";
import { InvestigationKpiGrid } from "../components/InvestigationKpiGrid";
import { InvestigationRefundsSection } from "../components/InvestigationRefundsSection";
import { InvestigationSearchBar } from "../components/InvestigationSearchBar";
import { InvestigationStaffSection } from "../components/InvestigationStaffSection";
import { InvestigationTabs } from "../components/InvestigationTabs";
import { VirtualizedActivityTimeline } from "../components/VirtualizedActivityTimeline";
import type { InvestigationWidgetDef, InvestigationWidgetProps } from "./investigationWidgetTypes";

function HeaderWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <PageHeader
      lang={ctx.lang}
      title={t(ctx.lang, "auditCenterTitle")}
      subtitle={t(ctx.lang, "icPageSub")}
      backLabel={t(ctx.lang, "officeBackToHub")}
    />
  );
}

function DateFilterWidget({ ctx }: InvestigationWidgetProps) {
  return <InvestigationDateFilter lang={ctx.lang} filter={ctx.quickFilter} onFilterChange={ctx.applyDateFilter} />;
}

function SharedKpiGridWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <InvestigationKpiGrid
      lang={ctx.lang}
      cards={ctx.kpiCards}
      activeKpi={ctx.sharedKpi}
      periodLabel={ctx.periodLabel}
      onSelect={ctx.handleKpiSelect}
    />
  );
}

function StatusWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <IncludeArchivedFilter lang={ctx.lang} checked={ctx.includeArchived} onChange={ctx.setIncludeArchived} />
  );
}

function TabsWidget({ ctx }: InvestigationWidgetProps) {
  return <InvestigationTabs lang={ctx.lang} active={ctx.tab} onChange={ctx.setTab} tabs={ctx.tabs} />;
}

function TimelineSearchWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <InvestigationSearchBar
      lang={ctx.lang}
      searchText={ctx.searchText}
      onSearchChange={ctx.onSearchTextChange}
      onOpenFilters={() => ctx.setFiltersOpen(true)}
      onOpenExport={() => ctx.setExportOpen(true)}
      resultCount={ctx.filtered.length}
    />
  );
}

function TimelineCategoriesWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <InvestigationCategoryChips
      lang={ctx.lang}
      active={ctx.category}
      onChange={ctx.setCategory}
      categories={ctx.categories}
      accentCategories={ctx.accentCategories}
    />
  );
}

function TimelineWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <VirtualizedActivityTimeline
      lang={ctx.lang}
      entries={ctx.filtered}
      productById={ctx.productById}
      customerById={ctx.customerById}
      getTimelinePresentation={ctx.getTimelinePresentation}
      onSelect={ctx.setSelected}
      onMenu={ctx.setMenuEntry}
    />
  );
}

function TimelinePanelWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <div className="space-y-3">
      <TimelineSearchWidget ctx={ctx} />
      <TimelineCategoriesWidget ctx={ctx} />
      <TimelineWidget ctx={ctx} />
    </div>
  );
}

function StaffReportsWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <InvestigationStaffSection
      lang={ctx.lang}
      entries={ctx.filtered}
      shifts={ctx.shiftsInRange}
      productById={ctx.productById}
      customerById={ctx.customerById}
      getTimelinePresentation={ctx.getTimelinePresentation}
      onSelect={ctx.setSelected}
      onMenu={ctx.setMenuEntry}
    />
  );
}

function RefundsReportsWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <InvestigationRefundsSection
      lang={ctx.lang}
      integrityReport={ctx.integrityReport}
      returns={ctx.returnsInRange}
      onTraceReturn={ctx.setTraceReturn}
    />
  );
}

function FooterSheetsWidget({ ctx }: InvestigationWidgetProps) {
  return (
    <>
      <InvestigationFiltersSheet
        lang={ctx.lang}
        open={ctx.filtersOpen}
        onClose={() => ctx.setFiltersOpen(false)}
        filters={ctx.filters}
        quickDate={ctx.quickFilter}
        actors={ctx.auditIndex.actors}
        products={ctx.products}
        customers={ctx.customers}
        suppliers={ctx.suppliers}
        onApply={ctx.applyFilters}
      />

      <InvestigationExportSheet
        lang={ctx.lang}
        open={ctx.exportOpen}
        disabled={ctx.filtered.length === 0}
        onClose={() => ctx.setExportOpen(false)}
        onExportCsv={() => ctx.downloadCsv()}
        onExportExcel={() => ctx.downloadExcel()}
        onExportPdf={() => void ctx.downloadPdf()}
        onExportJson={() => ctx.downloadJson()}
        onPrint={() => ctx.printEntries()}
        onShare={() => void ctx.shareEntries()}
      />

      <ActivityDetailSheet
        lang={ctx.lang}
        entry={ctx.selected}
        shopName={ctx.shopName}
        productById={ctx.productById}
        customerById={ctx.customerById}
        open={ctx.selected !== null}
        onClose={() => ctx.setSelected(null)}
        onCopy={() => ctx.selected && void ctx.copyEntry(ctx.selected)}
        onShare={() => ctx.selected && void ctx.shareEntries([ctx.selected])}
        onPrint={() => ctx.selected && ctx.printEntries([ctx.selected])}
        onExportPdf={() => ctx.selected && void ctx.downloadPdf([ctx.selected])}
      />

      <ActivityActionsSheet
        lang={ctx.lang}
        entry={ctx.menuEntry}
        open={ctx.menuEntry !== null}
        onClose={() => ctx.setMenuEntry(null)}
        onViewDetails={() => {
          if (ctx.menuEntry) ctx.setSelected(ctx.menuEntry);
          ctx.setMenuEntry(null);
        }}
        onCopy={() => ctx.menuEntry && void ctx.copyEntry(ctx.menuEntry)}
        onShare={() => ctx.menuEntry && void ctx.shareEntries([ctx.menuEntry])}
        onPrint={() => ctx.menuEntry && ctx.printEntries([ctx.menuEntry])}
        onExportPdf={() => ctx.menuEntry && void ctx.downloadPdf([ctx.menuEntry])}
        onExportCsv={() => ctx.menuEntry && ctx.downloadCsv([ctx.menuEntry])}
        onReportIssue={() => ctx.menuEntry && void ctx.shareEntries([ctx.menuEntry])}
      />

      <RefundCalculationDrawer
        lang={ctx.lang}
        open={ctx.traceReturn !== null}
        sale={ctx.traceReturn?.saleId ? (ctx.saleById.get(ctx.traceReturn.saleId) ?? null) : null}
        returnRecord={ctx.traceReturn}
        returnRecords={ctx.allReturns}
        actorLabel={
          ctx.traceReturn
            ? ctx.traceReturn.actorName?.trim() || actorDisplayLabel(ctx.traceReturn.actorUserId, ctx.lang)
            : ""
        }
        onClose={() => ctx.setTraceReturn(null)}
      />
    </>
  );
}

/** Shared enterprise investigation widgets — available to every business mode. */
export const RETAIL_INVESTIGATION_WIDGETS: InvestigationWidgetDef[] = [
  {
    id: "retail-header",
    slot: "header",
    priority: 100,
    businessTypes: "*",
    Component: HeaderWidget,
  },
  {
    id: "retail-date-filter",
    slot: "date-filter",
    priority: 100,
    businessTypes: "*",
    Component: DateFilterWidget,
  },
  {
    id: "retail-kpi-grid",
    slot: "kpi-grid",
    priority: 100,
    businessTypes: "*",
    Component: SharedKpiGridWidget,
  },
  {
    id: "retail-status",
    slot: "status",
    priority: 100,
    businessTypes: "*",
    Component: StatusWidget,
  },
  {
    id: "retail-tabs",
    slot: "tabs",
    priority: 100,
    businessTypes: "*",
    Component: TabsWidget,
  },
  {
    id: "retail-timeline-panel",
    slot: "timeline",
    priority: 100,
    businessTypes: "*",
    visible: (ctx) => ctx.tab === "timeline",
    Component: TimelinePanelWidget,
  },
  {
    id: "retail-staff-reports",
    slot: "reports",
    priority: 100,
    businessTypes: "*",
    visible: (ctx) => ctx.tab === "staff",
    Component: StaffReportsWidget,
  },
  {
    id: "retail-refunds-reports",
    slot: "reports",
    priority: 200,
    businessTypes: "*",
    visible: (ctx) => ctx.tab === "refunds",
    Component: RefundsReportsWidget,
  },
  {
    id: "retail-footer-sheets",
    slot: "footer",
    priority: 100,
    businessTypes: "*",
    Component: FooterSheetsWidget,
  },
];
