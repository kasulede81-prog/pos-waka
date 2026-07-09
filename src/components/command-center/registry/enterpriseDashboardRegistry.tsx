import { Fragment, Suspense } from "react";
import type { ReactNode } from "react";
import type { Permission } from "../../../types";
import type { DashboardWidgetSlot } from "./dashboardWidgetSlots";
import type { DashboardCenterContext, DashboardWidgetDef } from "./dashboardWidgetTypes";
import { dashboardModeMatches } from "./dashboardMode";
import { RETAIL_DASHBOARD_WIDGETS } from "./retailDashboardWidgets";
import { PHARMACY_DASHBOARD_WIDGETS } from "./pharmacyDashboardWidgets";
import { HOSPITALITY_DASHBOARD_WIDGETS } from "./hospitalityDashboardWidgets";
import { WHOLESALE_DASHBOARD_WIDGETS } from "./wholesaleDashboardWidgets";

const ALL_DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  ...RETAIL_DASHBOARD_WIDGETS,
  ...PHARMACY_DASHBOARD_WIDGETS,
  ...HOSPITALITY_DASHBOARD_WIDGETS,
  ...WHOLESALE_DASHBOARD_WIDGETS,
];

function widgetAllowed(widget: DashboardWidgetDef, ctx: DashboardCenterContext): boolean {
  if (!dashboardModeMatches(ctx.mode, widget.businessTypes)) return false;
  if (widget.permission && !ctx.can(widget.permission)) return false;
  if (widget.visible && !widget.visible(ctx)) return false;
  return true;
}

export function resolveDashboardWidgets(
  slot: DashboardWidgetSlot,
  ctx: DashboardCenterContext,
): DashboardWidgetDef[] {
  return ALL_DASHBOARD_WIDGETS.filter((widget) => widget.slot === slot && widgetAllowed(widget, ctx)).sort(
    (a, b) => a.priority - b.priority,
  );
}

export function renderDashboardWidgets(slot: DashboardWidgetSlot, ctx: DashboardCenterContext): ReactNode {
  const widgets = resolveDashboardWidgets(slot, ctx);
  if (widgets.length === 0) return null;
  return (
    <Fragment>
      {widgets.map((widget) => (
        <Suspense key={widget.id} fallback={null}>
          <widget.Component ctx={ctx} />
        </Suspense>
      ))}
    </Fragment>
  );
}

export function renderDashboardSlot(slot: DashboardWidgetSlot, ctx: DashboardCenterContext): ReactNode {
  return renderDashboardWidgets(slot, ctx);
}

export function createDashboardSlotRenderer(ctx: DashboardCenterContext) {
  return (slot: DashboardWidgetSlot) => renderDashboardSlot(slot, ctx);
}

export function listDashboardWidgets(filter?: {
  slot?: DashboardWidgetSlot;
  permission?: Permission;
}): DashboardWidgetDef[] {
  return ALL_DASHBOARD_WIDGETS.filter((widget) => {
    if (filter?.slot && widget.slot !== filter.slot) return false;
    if (filter?.permission && widget.permission !== filter.permission) return false;
    return true;
  });
}

export { ALL_DASHBOARD_WIDGETS };
