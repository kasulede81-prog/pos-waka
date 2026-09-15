import { FileDown } from "lucide-react";
import { PageHeader } from "../../layout/PageHeader";
import { IncludeArchivedFilter } from "../../office/IncludeArchivedFilter";
import { DateFilterArchiveNotice } from "../../shared/DateFilterArchiveNotice";
import { CommandCenterPageToolbar } from "../CommandCenterPageToolbar";
import { CommandCenterHealthHero } from "../CommandCenterHealthHero";
import { CommandCenterKpiGrid } from "../CommandCenterKpiGrid";
import { CommandCenterAttentionSection } from "../CommandCenterAttentionSection";
import { CommandCenterCloudCard } from "../CommandCenterCloudCard";
import { CommandCenterLiveOpsTiles } from "../CommandCenterLiveOpsTiles";
import { CommandCenterCashCard } from "../CommandCenterCashCard";
import { CommandCenterStaffCard } from "../CommandCenterStaffCard";
import { CommandCenterInventoryCard } from "../CommandCenterInventoryCard";
import { CommandCenterFinancialGrid } from "../CommandCenterFinancialGrid";
import { CommandCenterIntegrityPanel } from "../CommandCenterIntegrityPanel";
import { CommandCenterRecommendations } from "../CommandCenterRecommendations";
import { CommandCenterQuickActions } from "../CommandCenterQuickActions";
import { CommandCenterExecutiveFooter } from "../CommandCenterExecutiveFooter";
import { t } from "../../../lib/i18n";
import type { DashboardWidgetDef, DashboardWidgetProps } from "./dashboardWidgetTypes";

const COMMAND_CENTER_SURFACE = (ctx: DashboardWidgetProps["ctx"]) => ctx.surface === "command-center";

function HeaderWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx)) return null;
  return (
    <PageHeader
      lang={ctx.lang}
      title={t(ctx.lang, "ownerDashboardTitle")}
      subtitle={t(ctx.lang, "cmdCenterSub")}
      compact
      showBack
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={ctx.exportDashboard}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground shadow-sm"
        >
          <FileDown className="h-3.5 w-3.5" aria-hidden />
          {t(ctx.lang, "cmdCenterExport")}
        </button>
      </div>
    </PageHeader>
  );
}

function ToolbarWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.filter || !ctx.setFilter) return null;
  return (
    <CommandCenterPageToolbar
      lang={ctx.lang}
      filter={ctx.filter}
      onFilterChange={ctx.setFilter}
      searchOpen={ctx.searchOpen ?? false}
      onSearchToggle={() => ctx.setSearchOpen?.(!(ctx.searchOpen ?? false))}
      searchQuery={ctx.searchQuery ?? ""}
      onSearchChange={(q) => ctx.setSearchQuery?.(q)}
      shopName={ctx.shopName ?? "Waka POS"}
    />
  );
}

function ArchiveStatusWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx)) return null;
  return (
    <>
      {ctx.archiveNotice ? (
        <DateFilterArchiveNotice
          lang={ctx.lang}
          archivedCount={ctx.archivedSalesCount ?? 0}
          onEnableArchived={() => ctx.setIncludeArchived?.(true)}
        />
      ) : null}
      {ctx.needsArchive && ctx.includeArchived && (ctx.archivedSalesCount ?? 0) > 0 ? (
        <p className="text-xs font-semibold text-muted-foreground">{t(ctx.lang, "dateFilterArchiveIncluded")}</p>
      ) : null}
    </>
  );
}

function IncludeArchivedWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx)) return null;
  return (
    <IncludeArchivedFilter
      lang={ctx.lang}
      checked={ctx.includeArchived ?? false}
      onChange={(v) => ctx.setIncludeArchived?.(v)}
    />
  );
}

function HealthHeroWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || ctx.healthScore == null || !ctx.domainStatuses) return null;
  return <CommandCenterHealthHero lang={ctx.lang} score={ctx.healthScore} domains={ctx.domainStatuses} />;
}

function KpiGridWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.kpiCards) return null;
  return (
    <CommandCenterKpiGrid lang={ctx.lang} cards={ctx.kpiCards} periodLabel={ctx.periodLabel ?? ""} />
  );
}

function AttentionWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.filteredAttention || !ctx.commandCenter) return null;
  return (
    <CommandCenterAttentionSection
      lang={ctx.lang}
      critical={ctx.filteredAttention.critical}
      warnings={ctx.filteredAttention.warnings}
      information={ctx.filteredAttention.information}
      reviewedCritical={ctx.commandCenter.attentionReviewed.critical}
      reviewedWarnings={ctx.commandCenter.attentionReviewed.warnings}
      periodLabel={ctx.periodLabel ?? ""}
      onAcknowledge={ctx.onAcknowledge ?? (() => {})}
    />
  );
}

function CloudCardWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.cloudProtection) return null;
  return (
    <CommandCenterCloudCard
      lang={ctx.lang}
      cloud={ctx.cloudProtection}
      devicesOnline={ctx.devicesOnline ?? 0}
      devicesTotal={ctx.devicesTotal ?? 1}
    />
  );
}

function LiveOpsWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.commandCenter) return null;
  return (
    <CommandCenterLiveOpsTiles
      lang={ctx.lang}
      live={ctx.commandCenter.liveOps}
      expectedCashUgx={ctx.heroExpectedCash ?? 0}
    />
  );
}

function CashCardWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.commandCenter) return null;
  return <CommandCenterCashCard lang={ctx.lang} cash={ctx.commandCenter.cash} />;
}

function StaffCardWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.commandCenter) return null;
  return (
    <CommandCenterStaffCard
      lang={ctx.lang}
      rows={ctx.commandCenter.shiftRows}
      periodLabel={ctx.periodLabel ?? ""}
    />
  );
}

function InventoryCardWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.commandCenter) return null;
  return <CommandCenterInventoryCard lang={ctx.lang} inventory={ctx.commandCenter.inventory} />;
}

function FinancialGridWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.commandCenter) return null;
  return (
    <CommandCenterFinancialGrid
      lang={ctx.lang}
      financial={ctx.commandCenter.financial}
      periodLabel={ctx.periodLabel ?? ""}
      revenueSparkline={ctx.revenueSparkline ?? []}
    />
  );
}

function IntegrityPanelWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.commandCenter) return null;
  return <CommandCenterIntegrityPanel lang={ctx.lang} signals={ctx.commandCenter.integritySignals} />;
}

function RecommendationsWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || !ctx.recommendations) return null;
  return (
    <CommandCenterRecommendations
      lang={ctx.lang}
      recommendations={ctx.recommendations}
      sectionId={ctx.recommendationsSectionId ?? "cmd-center-recommendations"}
    />
  );
}

function QuickActionsWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx)) return null;
  return <CommandCenterQuickActions lang={ctx.lang} />;
}

function ExecutiveFooterWidget({ ctx }: DashboardWidgetProps) {
  if (!COMMAND_CENTER_SURFACE(ctx) || ctx.healthScore == null || !ctx.summaryKey) return null;
  return (
    <CommandCenterExecutiveFooter
      lang={ctx.lang}
      score={ctx.healthScore}
      summaryKey={ctx.summaryKey}
      summaryVars={ctx.summaryVars}
      onExport={ctx.exportDashboard ?? (() => {})}
      onShare={ctx.shareDashboard ?? (() => {})}
      onPrint={ctx.printDashboard ?? (() => {})}
    />
  );
}

/** Shared Command Center widgets — available on every business mode. */
export const RETAIL_DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  { id: "retail-header", slot: "header", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: HeaderWidget },
  { id: "retail-toolbar", slot: "status", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: ToolbarWidget },
  { id: "retail-archive-notice", slot: "status", priority: 20, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: ArchiveStatusWidget },
  { id: "retail-include-archived", slot: "status", priority: 30, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: IncludeArchivedWidget },
  { id: "retail-health-hero", slot: "health-hero", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: HealthHeroWidget },
  { id: "retail-kpi-grid", slot: "kpi-grid", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: KpiGridWidget },
  { id: "retail-attention", slot: "attention", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: AttentionWidget },
  { id: "retail-cloud-card", slot: "attention", priority: 20, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: CloudCardWidget },
  { id: "retail-live-ops", slot: "live-operations", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: LiveOpsWidget },
  { id: "retail-cash", slot: "cash", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: CashCardWidget },
  { id: "retail-staff", slot: "staff", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: StaffCardWidget },
  { id: "retail-inventory", slot: "inventory", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: InventoryCardWidget },
  { id: "retail-financial", slot: "financial", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: FinancialGridWidget },
  { id: "retail-integrity", slot: "integrity", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: IntegrityPanelWidget },
  { id: "retail-recommendations", slot: "recommendations", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: RecommendationsWidget },
  { id: "retail-quick-actions", slot: "quick-actions", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: QuickActionsWidget },
  { id: "retail-footer", slot: "footer", priority: 10, businessTypes: "*", visible: COMMAND_CENTER_SURFACE, Component: ExecutiveFooterWidget },
];
