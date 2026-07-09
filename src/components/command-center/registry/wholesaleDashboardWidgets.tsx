import type { DashboardWidgetDef } from "./dashboardWidgetTypes";

function WholesalePlaceholderWidget() {
  return null;
}

/** Wholesale dashboard extensions — warehouse, bulk orders, deliveries, receivables, fleet. */
export const WHOLESALE_DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  {
    id: "wholesale-warehouse",
    slot: "inventory",
    priority: 100,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-bulk-orders",
    slot: "live-operations",
    priority: 100,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-deliveries",
    slot: "live-operations",
    priority: 110,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-receivables",
    slot: "financial",
    priority: 100,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-fleet",
    slot: "live-operations",
    priority: 120,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
];
