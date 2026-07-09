/** Ordered widget slots for the Enterprise Dashboard shell. */
export const DASHBOARD_WIDGET_SLOTS = [
  "header",
  "status",
  "health-hero",
  "attention",
  "kpi-grid",
  "live-operations",
  "cash",
  "inventory",
  "staff",
  "financial",
  "recommendations",
  "integrity",
  "quick-actions",
  "insights",
  "footer",
] as const;

export type DashboardWidgetSlot = (typeof DASHBOARD_WIDGET_SLOTS)[number];
