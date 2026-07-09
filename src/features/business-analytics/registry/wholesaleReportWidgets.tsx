import { WholesaleReportsSection } from "../components/AnalyticsModeReports";
import type { ReportWidgetDef, ReportWidgetProps } from "./reportWidgetTypes";

function WholesaleOperationsWidget({ ctx }: ReportWidgetProps) {
  if (!ctx.wholesaleSection) return null;
  return <WholesaleReportsSection lang={ctx.lang} wholesaleSection={ctx.wholesaleSection} />;
}

function WholesalePlaceholderWidget() {
  return null;
}

/** Wholesale report extensions — warehouse, receivables, deliveries, fleet. */
export const WHOLESALE_REPORT_WIDGETS: ReportWidgetDef[] = [
  {
    id: "wholesale-operations-overview",
    slot: "operations",
    priority: 100,
    businessTypes: ["wholesale"],
    visible: (ctx) => ctx.category === "overview",
    Component: WholesaleOperationsWidget,
  },
  {
    id: "wholesale-warehouse",
    slot: "inventory",
    priority: 900,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-receivables",
    slot: "financial",
    priority: 900,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-deliveries",
    slot: "operations",
    priority: 910,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-bulk-orders",
    slot: "sales",
    priority: 900,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
  {
    id: "wholesale-fleet",
    slot: "operations",
    priority: 920,
    businessTypes: ["wholesale"],
    visible: () => false,
    Component: WholesalePlaceholderWidget,
  },
];
