import { useMemo } from "react";
import type { DashboardWidgetSlot } from "./registry/dashboardWidgetSlots";
import type { DashboardCenterContext } from "./registry/dashboardWidgetTypes";
import { createDashboardSlotRenderer, renderDashboardSlot } from "./registry/enterpriseDashboardRegistry";
import { dashboardSlotsForSurface } from "./registry/dashboardCatalog";

export function EnterpriseDashboardShell({ ctx }: { ctx: DashboardCenterContext }) {
  const renderSlot = useMemo(() => createDashboardSlotRenderer(ctx), [ctx]);
  const orderedSlots = dashboardSlotsForSurface(ctx.surface);
  const className =
    ctx.className ??
    (ctx.surface === "pharmacy-operations"
      ? "enterprise-page space-y-6 bg-stone-50/40"
      : "enterprise-page space-y-4 sm:space-y-5");

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

  let skipStaff = false;
  return (
    <div className={className}>
      {orderedSlots.map((slot) => {
        if (slot === "staff" && skipStaff) return null;

        if (slot === "attention") {
          const content = renderDashboardSlot("attention", ctx);
          if (!content) return null;
          return (
            <div key={slot} className="grid gap-4 lg:grid-cols-2">
              {content}
            </div>
          );
        }

        if (slot === "cash") {
          const cash = renderDashboardSlot("cash", ctx);
          const staff = renderDashboardSlot("staff", ctx);
          skipStaff = Boolean(cash && staff);
          if (!cash && !staff) return null;
          if (skipStaff) {
            return (
              <div key="cash-staff" className="grid gap-4 lg:grid-cols-2">
                {cash}
                {staff}
              </div>
            );
          }
          return <div key={slot}>{cash}</div>;
        }

        const content = renderSlot(slot as DashboardWidgetSlot);
        if (!content) return null;
        return <div key={slot}>{content}</div>;
      })}
    </div>
  );
}
