import { Fragment, Suspense } from "react";
import type { ReactNode } from "react";
import type { Permission } from "../../../types";
import type { ReportWidgetSlot } from "./reportWidgetSlots";
import type { ReportsCenterContext, ReportWidgetDef } from "./reportWidgetTypes";
import { reportsModeMatches } from "./reportsMode";
import { RETAIL_REPORT_WIDGETS } from "./retailReportWidgets";
import { PHARMACY_REPORT_WIDGETS } from "./pharmacyReportWidgets";
import { HOSPITALITY_REPORT_WIDGETS } from "./hospitalityReportWidgets";
import { WHOLESALE_REPORT_WIDGETS } from "./wholesaleReportWidgets";

const ALL_REPORT_WIDGETS: ReportWidgetDef[] = [
  ...RETAIL_REPORT_WIDGETS,
  ...PHARMACY_REPORT_WIDGETS,
  ...HOSPITALITY_REPORT_WIDGETS,
  ...WHOLESALE_REPORT_WIDGETS,
];

function widgetAllowed(widget: ReportWidgetDef, ctx: ReportsCenterContext): boolean {
  if (!reportsModeMatches(ctx.mode, widget.businessTypes)) return false;
  if (widget.permission && !ctx.can(widget.permission)) return false;
  if (widget.visible && !widget.visible(ctx)) return false;
  return true;
}

export function resolveReportWidgets(
  slot: ReportWidgetSlot,
  ctx: ReportsCenterContext,
): ReportWidgetDef[] {
  return ALL_REPORT_WIDGETS.filter((widget) => widget.slot === slot && widgetAllowed(widget, ctx)).sort(
    (a, b) => a.priority - b.priority,
  );
}

export function renderReportWidgets(slot: ReportWidgetSlot, ctx: ReportsCenterContext): ReactNode {
  const widgets = resolveReportWidgets(slot, ctx);
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

export function renderReportSlot(slot: ReportWidgetSlot, ctx: ReportsCenterContext): ReactNode {
  return renderReportWidgets(slot, ctx);
}

export function createReportSlotRenderer(ctx: ReportsCenterContext) {
  return (slot: ReportWidgetSlot) => renderReportSlot(slot, ctx);
}

export function listReportWidgets(filter?: {
  slot?: ReportWidgetSlot;
  permission?: Permission;
}): ReportWidgetDef[] {
  return ALL_REPORT_WIDGETS.filter((widget) => {
    if (filter?.slot && widget.slot !== filter.slot) return false;
    if (filter?.permission && widget.permission !== filter.permission) return false;
    return true;
  });
}

export { ALL_REPORT_WIDGETS };
