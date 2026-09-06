import type { DashboardSurface } from "./dashboardWidgetTypes";

export const COMMAND_CENTER_SLOT_ORDER = [
  "header",
  "status",
  "health-hero",
  "kpi-grid",
  "financial",
  "cash",
  "staff",
  "inventory",
  "live-operations",
  "integrity",
  "attention",
  "recommendations",
  "quick-actions",
  "footer",
] as const;

export const PHARMACY_OPS_SLOT_ORDER = [
  "header",
  "status",
  "health-hero",
  "live-operations",
  "inventory",
  "insights",
  "attention",
  "quick-actions",
  "footer",
] as const;

export function dashboardSlotsForSurface(surface: DashboardSurface): readonly string[] {
  return surface === "pharmacy-operations" ? PHARMACY_OPS_SLOT_ORDER : COMMAND_CENTER_SLOT_ORDER;
}
