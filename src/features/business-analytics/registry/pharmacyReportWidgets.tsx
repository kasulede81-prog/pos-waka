import { PharmacyReportsSection } from "../components/AnalyticsModeReports";
import { resolveDateFilterBounds, stockMovementsInBounds } from "../../../lib/dateFilters";
import type { ReportWidgetDef, ReportWidgetProps } from "./reportWidgetTypes";

function PharmacyOperationsWidget({ ctx }: ReportWidgetProps) {
  if (!ctx.pharmacyExpiryReport) return null;
  const bounds = resolveDateFilterBounds(ctx.filter);
  const movements = stockMovementsInBounds(ctx.stockMovements, bounds);
  return (
    <PharmacyReportsSection
      lang={ctx.lang}
      products={ctx.products}
      stockMovements={movements}
      pharmacyExpiryReport={ctx.pharmacyExpiryReport}
      periodLabel={ctx.periodLabel}
    />
  );
}

function PharmacyCompliancePlaceholderWidget() {
  return null;
}

/** Pharmacy report extensions — composed into the shared Enterprise shell. */
export const PHARMACY_REPORT_WIDGETS: ReportWidgetDef[] = [
  {
    id: "pharmacy-operations-overview",
    slot: "operations",
    priority: 100,
    businessTypes: ["pharmacy"],
    visible: (ctx) => ctx.category === "overview",
    Component: PharmacyOperationsWidget,
  },
  {
    id: "pharmacy-compliance-reports",
    slot: "compliance",
    priority: 900,
    businessTypes: ["pharmacy"],
    visible: () => false,
    Component: PharmacyCompliancePlaceholderWidget,
  },
  {
    id: "pharmacy-batch-analytics",
    slot: "inventory",
    priority: 900,
    businessTypes: ["pharmacy"],
    visible: () => false,
    Component: PharmacyCompliancePlaceholderWidget,
  },
  {
    id: "pharmacy-prescriptions",
    slot: "reports",
    priority: 900,
    businessTypes: ["pharmacy"],
    visible: () => false,
    Component: PharmacyCompliancePlaceholderWidget,
  },
  {
    id: "pharmacy-medicine-margins",
    slot: "financial",
    priority: 900,
    businessTypes: ["pharmacy"],
    visible: () => false,
    Component: PharmacyCompliancePlaceholderWidget,
  },
];
