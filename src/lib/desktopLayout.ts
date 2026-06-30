/**
 * Shared responsive layout helpers for desktop KPI grids and content width.
 */

/** Hero metric strip (HistoryHeroCard) — stacks on narrow, 3-up on lg+. */
export function historyHeroMetricGridClass(metricCount: number): string {
  if (metricCount <= 1) return "grid-cols-1";
  if (metricCount === 2) return "grid-cols-1 min-[480px]:grid-cols-2";
  return "grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3";
}

/** Owner / cashier dashboard KPI cards. */
export function dashboardKpiGridClass(extraLgCols?: "2" | "3"): string {
  const lg = extraLgCols === "3" ? "lg:grid-cols-3" : extraLgCols === "2" ? "lg:grid-cols-2" : "lg:grid-cols-3";
  return `grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 ${lg} xl:grid-cols-4 2xl:grid-cols-4`;
}

/** Internal admin pulse KPI cards. */
export function adminKpiGridClass(): string {
  return "grid grid-cols-2 gap-2 min-[520px]:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6";
}

/** Wide back-office / admin content column — balanced on ultrawide without overstretching. */
export function desktopContentMaxWidthClass(): string {
  return "mx-auto w-full min-w-0 max-w-full xl:max-w-6xl 2xl:max-w-7xl";
}

/** Currency / numeric KPI value — prevents clipping on narrow desktop columns. */
export const KPI_VALUE_CLASS =
  "break-words tabular-nums leading-tight min-w-0 [overflow-wrap:anywhere]";
