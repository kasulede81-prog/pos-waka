import type { SparkPoint } from "../../../lib/commandCenterPageView";
import { dateKeyDaysAgoKampala, dateKeyKampala } from "../../../lib/datesUg";
import type { DateFilterBounds } from "../../../lib/dateFilters";

/** i18n key for the KPI sparkline context (not the selected report period). */
export const REPORTS_KPI_SPARKLINE_LABEL_KEY = "baKpiSparklineLast7Days";

/** Same window as `computeDailyRevenueSparkline(sales, 7)`: today-6 → today. */
export function reportsRollingSevenDayBounds(): DateFilterBounds {
  const toKey = dateKeyKampala(new Date());
  const fromKey = dateKeyDaysAgoKampala(6);
  return { fromKey, toKey, isSingleDay: fromKey === toKey };
}

export function reportsKpiSparklineOverlapsSelected(selected: DateFilterBounds): boolean {
  const window = reportsRollingSevenDayBounds();
  return selected.toKey >= window.fromKey && selected.fromKey <= window.toKey;
}

export function presentReportsKpiSparkline(
  points: SparkPoint[],
  opts: {
    dataComplete: boolean;
    closedDayBreakdownUnavailable: boolean;
    selectedBounds: DateFilterBounds;
  },
): SparkPoint[] {
  if (!opts.dataComplete || opts.closedDayBreakdownUnavailable) return [];
  if (!reportsKpiSparklineOverlapsSelected(opts.selectedBounds)) return [];
  return points;
}
