import { useMemo } from "react";
import type { DashboardWidgetSlot } from "./registry/dashboardWidgetSlots";
import type { DashboardCenterContext } from "./registry/dashboardWidgetTypes";
import { createDashboardSlotRenderer, renderDashboardSlot } from "./registry/enterpriseDashboardRegistry";
import { dashboardSlotsForSurface } from "./registry/dashboardCatalog";

export function EnterpriseDashboardShell({ ctx }: { ctx: DashboardCenterContext }) {
  const renderSlot = useMemo(() => createDashboardSlotRenderer(ctx), [ctx]);
  const orderedSlots = dashboardSlotsForSurface(ctx.surface);
  /** Phase 29.1 — one page stack rhythm across CC / pharmacy / ops */
  const className =
    ctx.className ??
    (ctx.surface === "pharmacy-operations"
      ? "enterprise-page space-y-4 sm:space-y-6 bg-muted/40"
      : "enterprise-page space-y-4 sm:space-y-6");

  if (ctx.surface === "pharmacy-operations") {
    return (
      <div className={className}>
        {orderedSlots.map((slot) => {
          if (slot === "inventory") {
            const inventoryRow = renderDashboardSlot("inventory", ctx);
            if (!inventoryRow) return null;
            return (
              <div key={slot} className="grid gap-4 xl:grid-cols-3">
                {inventoryRow}
              </div>
            );
          }
          if (slot === "insights") {
            const activity = renderDashboardSlot("insights", ctx);
            const attention = renderDashboardSlot("attention", ctx);
            const quickActions = renderDashboardSlot("quick-actions", ctx);
            if (!activity && !attention && !quickActions) return null;
            return (
              <div key="insights-row" className="grid gap-4 xl:grid-cols-3">
                {activity}
                <div className="space-y-4">
                  {attention}
                  {quickActions}
                </div>
              </div>
            );
          }
          if (slot === "attention" || slot === "quick-actions") {
            return null;
          }
          return <div key={slot}>{renderSlot(slot as DashboardWidgetSlot)}</div>;
        })}
      </div>
    );
  }

  let skipCash = false;
  return (
    <div className={className}>
      {orderedSlots.map((slot) => {
        if (slot === "cash" && skipCash) return null;

        if (slot === "attention") {
          const content = renderDashboardSlot("attention", ctx);
          if (!content) return null;
          return (
            <div key={slot} className="grid gap-4 lg:grid-cols-2">
              {content}
            </div>
          );
        }

        if (slot === "financial") {
          const financial = renderDashboardSlot("financial", ctx);
          const cash = renderDashboardSlot("cash", ctx);
          skipCash = Boolean(financial && cash);
          if (!financial && !cash) return null;
          if (skipCash) {
            return (
              <div key="financial-cash" className="grid gap-4 lg:grid-cols-2">
                {financial}
                {cash}
              </div>
            );
          }
          return <div key={slot}>{financial}</div>;
        }

        const content = renderSlot(slot as DashboardWidgetSlot);
        if (!content) return null;
        return <div key={slot}>{content}</div>;
      })}
    </div>
  );
}
