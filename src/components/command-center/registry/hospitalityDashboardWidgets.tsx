import type { DashboardWidgetDef } from "./dashboardWidgetTypes";

function HospitalityPlaceholderWidget() {
  return null;
}

/** Hospitality dashboard extensions — kitchen, tables, reservations, waiters. */
export const HOSPITALITY_DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  {
    id: "hospitality-kitchen-queue",
    slot: "live-operations",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-open-tables",
    slot: "live-operations",
    priority: 110,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-reservations",
    slot: "attention",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-waiter-performance",
    slot: "staff",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-covers",
    slot: "kpi-grid",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-menu-performance",
    slot: "financial",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-bar-queue",
    slot: "live-operations",
    priority: 120,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
];
