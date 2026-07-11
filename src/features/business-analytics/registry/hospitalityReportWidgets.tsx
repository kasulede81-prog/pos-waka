import { HospitalityReportsSection } from "../components/AnalyticsModeReports";
import type { ReportWidgetDef, ReportWidgetProps } from "./reportWidgetTypes";

function HospitalityOperationsWidget({ ctx }: ReportWidgetProps) {
  if (!ctx.hospitalityReports) return null;
  return (
    <HospitalityReportsSection
      lang={ctx.lang}
      hospitalityReports={ctx.hospitalityReports}
      hospitalityOpenBills={ctx.hospitalityOpenBills}
      hospitalityFloor={ctx.hospitalityFloor}
    />
  );
}

/** Hospitality reports — operations overview uses existing analytics section. */
export const HOSPITALITY_REPORT_WIDGETS: ReportWidgetDef[] = [
  {
    id: "hospitality-operations-overview",
    slot: "operations",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: (ctx) => ctx.category === "overview",
    Component: HospitalityOperationsWidget,
  },
];
