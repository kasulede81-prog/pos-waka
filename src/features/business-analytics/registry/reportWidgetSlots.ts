/** Ordered widget slots for the Enterprise Reports shell. */
export const REPORT_WIDGET_SLOTS = [
  "header",
  "status",
  "date-filter",
  "filters",
  "search",
  "overview-kpis",
  "financial",
  "sales",
  "inventory",
  "customers",
  "employees",
  "cash",
  "charts",
  "operations",
  "compliance",
  "reports",
  "exports",
  "footer",
] as const;

export type ReportWidgetSlot = (typeof REPORT_WIDGET_SLOTS)[number];
