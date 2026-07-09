import type { DashboardWidgetDef, DashboardWidgetProps } from "./dashboardWidgetTypes";
import {
  PharmacyOpsHeaderSection,
  PharmacyOpsStatusStripSection,
  PharmacyOpsTrustBannerSection,
  PharmacyOpsWorkflowSection,
  PharmacyOpsInventoryAlertsSection,
  PharmacyOpsPatientsSection,
  PharmacyOpsPerformanceSection,
  PharmacyOpsActivitySection,
  PharmacyOpsUpcomingSection,
  PharmacyOpsQuickActionsSection,
  PharmacyOpsWriteOffSection,
  PharmacyOpsFooterSection,
} from "../../pharmacy/dashboard/PharmacyOpsDashboardSections";

const PHARMACY_OPS_SURFACE = (ctx: DashboardWidgetProps["ctx"]) => ctx.surface === "pharmacy-operations";

function PharmacyHeaderWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsHeaderSection ctx={ctx} />;
}

function PharmacyStatusWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsStatusStripSection ctx={ctx} />;
}

function PharmacyTrustBannerWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsTrustBannerSection ctx={ctx} />;
}

function PharmacyWorkflowWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsWorkflowSection ctx={ctx} />;
}

function PharmacyInventoryAlertsWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsInventoryAlertsSection ctx={ctx} />;
}

function PharmacyPatientsWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsPatientsSection ctx={ctx} />;
}

function PharmacyPerformanceWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsPerformanceSection ctx={ctx} />;
}

function PharmacyActivityWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsActivitySection ctx={ctx} />;
}

function PharmacyUpcomingWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsUpcomingSection ctx={ctx} />;
}

function PharmacyQuickActionsWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsQuickActionsSection ctx={ctx} />;
}

function PharmacyWriteOffWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsWriteOffSection ctx={ctx} />;
}

function PharmacyFooterWidget({ ctx }: DashboardWidgetProps) {
  if (!PHARMACY_OPS_SURFACE(ctx)) return null;
  return <PharmacyOpsFooterSection ctx={ctx} />;
}

/** Pharmacy operational dashboard widgets — injected on pharmacy home. */
export const PHARMACY_DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  { id: "pharmacy-header", slot: "header", priority: 10, businessTypes: ["pharmacy"], visible: PHARMACY_OPS_SURFACE, Component: PharmacyHeaderWidget },
  { id: "pharmacy-status", slot: "status", priority: 10, businessTypes: ["pharmacy"], visible: PHARMACY_OPS_SURFACE, Component: PharmacyStatusWidget },
  { id: "pharmacy-trust-banner", slot: "health-hero", priority: 10, businessTypes: ["pharmacy"], visible: PHARMACY_OPS_SURFACE, Component: PharmacyTrustBannerWidget },
  { id: "pharmacy-workflow", slot: "live-operations", priority: 10, businessTypes: ["pharmacy"], visible: PHARMACY_OPS_SURFACE, Component: PharmacyWorkflowWidget },
  { id: "pharmacy-inventory-alerts", slot: "inventory", priority: 10, businessTypes: ["pharmacy"], permission: "stock.view", visible: PHARMACY_OPS_SURFACE, Component: PharmacyInventoryAlertsWidget },
  { id: "pharmacy-patients", slot: "inventory", priority: 20, businessTypes: ["pharmacy"], permission: "customers.view", visible: PHARMACY_OPS_SURFACE, Component: PharmacyPatientsWidget },
  { id: "pharmacy-performance", slot: "inventory", priority: 30, businessTypes: ["pharmacy"], visible: (ctx) => PHARMACY_OPS_SURFACE(ctx) && Boolean(ctx.showRevenue || ctx.canProfit), Component: PharmacyPerformanceWidget },
  { id: "pharmacy-activity", slot: "insights", priority: 10, businessTypes: ["pharmacy"], permission: "owner.activity", visible: PHARMACY_OPS_SURFACE, Component: PharmacyActivityWidget },
  { id: "pharmacy-upcoming", slot: "attention", priority: 10, businessTypes: ["pharmacy"], visible: PHARMACY_OPS_SURFACE, Component: PharmacyUpcomingWidget },
  { id: "pharmacy-quick-actions", slot: "quick-actions", priority: 10, businessTypes: ["pharmacy"], visible: PHARMACY_OPS_SURFACE, Component: PharmacyQuickActionsWidget },
  { id: "pharmacy-write-off", slot: "footer", priority: 10, businessTypes: ["pharmacy"], visible: PHARMACY_OPS_SURFACE, Component: PharmacyWriteOffWidget },
  { id: "pharmacy-footer-tip", slot: "footer", priority: 20, businessTypes: ["pharmacy"], visible: PHARMACY_OPS_SURFACE, Component: PharmacyFooterWidget },
];
