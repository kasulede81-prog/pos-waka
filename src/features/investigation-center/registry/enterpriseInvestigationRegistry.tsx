import { Fragment, Suspense } from "react";
import type { ReactNode } from "react";
import type { Permission } from "../../../types";
import type { InvestigationWidgetSlot } from "./investigationWidgetSlots";
import type {
  InvestigationCenterContext,
  InvestigationWidgetDef,
} from "./investigationWidgetTypes";
import { investigationModeMatches } from "./investigationMode";
import { RETAIL_INVESTIGATION_WIDGETS } from "./retailWidgets";
import { PHARMACY_INVESTIGATION_WIDGETS } from "./pharmacyWidgets";
import { HOSPITALITY_INVESTIGATION_WIDGETS } from "./hospitalityWidgets";
import { WHOLESALE_INVESTIGATION_WIDGETS } from "./wholesaleWidgets";

const ALL_INVESTIGATION_WIDGETS: InvestigationWidgetDef[] = [
  ...RETAIL_INVESTIGATION_WIDGETS,
  ...PHARMACY_INVESTIGATION_WIDGETS,
  ...HOSPITALITY_INVESTIGATION_WIDGETS,
  ...WHOLESALE_INVESTIGATION_WIDGETS,
];

function widgetAllowed(
  widget: InvestigationWidgetDef,
  ctx: InvestigationCenterContext,
): boolean {
  if (!investigationModeMatches(ctx.mode, widget.businessTypes)) return false;
  if (widget.permission && !ctx.can(widget.permission)) return false;
  if (widget.visible && !widget.visible(ctx)) return false;
  return true;
}

export function resolveInvestigationWidgets(
  slot: InvestigationWidgetSlot,
  ctx: InvestigationCenterContext,
): InvestigationWidgetDef[] {
  return ALL_INVESTIGATION_WIDGETS.filter((widget) => widget.slot === slot && widgetAllowed(widget, ctx)).sort(
    (a, b) => a.priority - b.priority,
  );
}

function renderWidget(widget: InvestigationWidgetDef, ctx: InvestigationCenterContext): ReactNode {
  const { Component } = widget;
  return (
    <Suspense key={widget.id} fallback={null}>
      <Component ctx={ctx} />
    </Suspense>
  );
}

export function renderInvestigationSlot(
  slot: InvestigationWidgetSlot,
  ctx: InvestigationCenterContext,
): ReactNode {
  const widgets = resolveInvestigationWidgets(slot, ctx);
  if (widgets.length === 0) return null;
  if (widgets.length === 1) return renderWidget(widgets[0]!, ctx);
  return <Fragment>{widgets.map((widget) => renderWidget(widget, ctx))}</Fragment>;
}

export function createInvestigationSlotRenderer(ctx: InvestigationCenterContext) {
  return (slot: InvestigationWidgetSlot) => renderInvestigationSlot(slot, ctx);
}

export function listInvestigationWidgets(filter?: {
  slot?: InvestigationWidgetSlot;
  permission?: Permission;
}): InvestigationWidgetDef[] {
  return ALL_INVESTIGATION_WIDGETS.filter((widget) => {
    if (filter?.slot && widget.slot !== filter.slot) return false;
    if (filter?.permission && widget.permission !== filter.permission) return false;
    return true;
  });
}

export { ALL_INVESTIGATION_WIDGETS };
