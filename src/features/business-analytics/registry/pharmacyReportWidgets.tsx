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

/** Pharmacy reports — operations overview uses existing analytics section. */
export const PHARMACY_REPORT_WIDGETS: ReportWidgetDef[] = [
  {
    id: "pharmacy-operations-overview",
    slot: "operations",
    priority: 100,
    businessTypes: ["pharmacy"],
    visible: (ctx) => ctx.category === "overview",
    Component: PharmacyOperationsWidget,
  },
];
