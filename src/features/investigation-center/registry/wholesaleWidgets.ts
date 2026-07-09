import type { InvestigationWidgetDef } from "./investigationWidgetTypes";

function WholesalePlaceholderWidget() {
  return null;
}

/** Wholesale investigation placeholders — registered for future extension. */
export const WHOLESALE_INVESTIGATION_WIDGETS: InvestigationWidgetDef[] = [
  {
    id: "wholesale-warehouse",
    slot: "kpi-grid",
    priority: 900,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-bulk-receiving",
    slot: "timeline",
    priority: 900,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-fleet",
    slot: "reports",
    priority: 900,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-deliveries",
    slot: "timeline-categories",
    priority: 900,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-receivables",
    slot: "kpi-grid",
    priority: 910,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
];
