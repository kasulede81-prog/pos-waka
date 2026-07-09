/** Ordered widget slots for the Enterprise Investigation Center shell. */
export const INVESTIGATION_WIDGET_SLOTS = [
  "header",
  "status",
  "date-filter",
  "search",
  "kpi-grid",
  "alerts",
  "timeline",
  "timeline-categories",
  "timeline-renderer",
  "tabs",
  "reports",
  "compliance",
  "quick-actions",
  "footer",
] as const;

export type InvestigationWidgetSlot = (typeof INVESTIGATION_WIDGET_SLOTS)[number];
