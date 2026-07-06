import type { EnterpriseDashboardMetrics } from "../../types/enterprise";

export type EnterpriseTrendPoint = { label: string; valueUgx: number };

export function revenueTrendFromMetrics(metrics: EnterpriseDashboardMetrics): EnterpriseTrendPoint[] {
  return [{ label: "today", valueUgx: metrics.todaySalesUgx }];
}

export function branchGrowthScore(metrics: EnterpriseDashboardMetrics): number {
  if (metrics.branchCount <= 1) return 100;
  const onlineRatio = metrics.branchCount > 0 ? metrics.branchesOnline / metrics.branchCount : 0;
  return Math.round(onlineRatio * 100);
}

export function peakHourPlaceholder(): string {
  return "—";
}
