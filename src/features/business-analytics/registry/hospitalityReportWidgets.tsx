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

function HospitalityPlaceholderWidget() {
  return null;
}

/** Hospitality report extensions — kitchen, tables, reservations, waiters. */
export const HOSPITALITY_REPORT_WIDGETS: ReportWidgetDef[] = [
  {
    id: "hospitality-operations-overview",
    slot: "operations",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: (ctx) => ctx.category === "overview",
    Component: HospitalityOperationsWidget,
  },
  {
    id: "hospitality-kitchen",
    slot: "operations",
    priority: 900,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-tables",
    slot: "reports",
    priority: 900,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-reservations",
    slot: "operations",
    priority: 910,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-menu",
    slot: "sales",
    priority: 900,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-waiters",
    slot: "employees",
    priority: 900,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
];
