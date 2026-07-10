import { StockActivityReportsSection } from "../components/AnalyticsModeReports";
import { resolveDateFilterBounds, stockMovementsInBounds } from "../../../lib/dateFilters";
import type { ReportWidgetDef, ReportWidgetProps } from "./reportWidgetTypes";

function RetailStockActivityWidget({ ctx }: ReportWidgetProps) {
  const bounds = resolveDateFilterBounds(ctx.filter);
  const movements = stockMovementsInBounds(ctx.stockMovements, bounds);
  return (
    <StockActivityReportsSection
      lang={ctx.lang}
      movements={movements}
      periodLabel={ctx.periodLabel}
      titleKey="stockMovementTitle"
      emptyInPeriod
    />
  );
}

function WholesaleStockActivityWidget({ ctx }: ReportWidgetProps) {
  const bounds = resolveDateFilterBounds(ctx.filter);
  const movements = stockMovementsInBounds(ctx.stockMovements, bounds);
  return (
    <StockActivityReportsSection
      lang={ctx.lang}
      movements={movements}
      periodLabel={ctx.periodLabel}
      titleKey="wholesaleReportsMovementTitle"
      wholesaleMode
      emptyInPeriod
    />
  );
}

/** Date-filtered stock activity for retail and wholesale Reports → Overview. */
export const STOCK_ACTIVITY_REPORT_WIDGETS: ReportWidgetDef[] = [
  {
    id: "retail-stock-activity",
    slot: "operations",
    priority: 200,
    businessTypes: ["retail"],
    visible: (ctx) => ctx.category === "overview",
    Component: RetailStockActivityWidget,
  },
  {
    id: "wholesale-stock-activity",
    slot: "operations",
    priority: 200,
    businessTypes: ["wholesale"],
    visible: (ctx) => ctx.category === "overview",
    Component: WholesaleStockActivityWidget,
  },
];
