import { WholesaleReportsSection } from "../components/AnalyticsModeReports";
import type { ReportWidgetDef, ReportWidgetProps } from "./reportWidgetTypes";

function WholesaleOperationsWidget({ ctx }: ReportWidgetProps) {
  if (!ctx.wholesaleSection) return null;
  return <WholesaleReportsSection lang={ctx.lang} wholesaleSection={ctx.wholesaleSection} />;
}

/** Wholesale reports — operations overview uses existing analytics section. */
export const WHOLESALE_REPORT_WIDGETS: ReportWidgetDef[] = [
  {
    id: "wholesale-operations-overview",
    slot: "operations",
    priority: 100,
    businessTypes: ["wholesale"],
    visible: (ctx) => ctx.category === "overview",
    Component: WholesaleOperationsWidget,
  },
];
