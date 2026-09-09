import type { HomeMetricScope } from "./homeVisibility";
import type { HomeKpiAvailability, HomeTileIntensity, HomeTileLiveStat } from "./homeExecutiveKpis";

export type { HomeKpiAvailability };
export type HomeShopKpiOverlayStatus = "idle" | "loading" | "ready" | "unavailable";

export const HOME_KPI_PLACEHOLDER = "—";

/**
 * Effect identity for the shop overlay fetch. Queue *depth* is ignored;
 * only idle↔busy, day/month, and completed sync timestamps refetch.
 */
export function homeKpiOverlayRefreshIdentity(input: {
  active: boolean;
  todayKey: string;
  monthKey: string;
  queueIdle: boolean;
  lastSuccessAt?: string | null;
  lastPullAt?: string | null;
}): string {
  return [
    input.active ? "1" : "0",
    input.todayKey,
    input.monthKey,
    input.queueIdle ? "idle" : "busy",
    input.lastSuccessAt ?? "",
    input.lastPullAt ?? "",
  ].join("|");
}

export function resolveHomeShopTodayAvailability(input: {
  scope: HomeMetricScope;
  overlayExpected: boolean;
  overlayStatus: HomeShopKpiOverlayStatus;
  overlayHasToday: boolean;
  freezeToday: boolean;
}): HomeKpiAvailability {
  if (input.scope !== "shop_wide") return "ready";
  if (!input.overlayExpected) return "ready";
  if (input.freezeToday) return "ready";
  if (input.overlayStatus === "loading" || input.overlayStatus === "idle") return "loading";
  if (input.overlayStatus === "unavailable") return "unavailable";
  if (!input.overlayHasToday) return "unavailable";
  return "ready";
}

export function resolveHomeShopMonthAvailability(input: {
  scope: HomeMetricScope;
  overlayExpected: boolean;
  overlayStatus: HomeShopKpiOverlayStatus;
  overlayHasMonth: boolean;
  salesHydrating: boolean;
  hydrationComplete: boolean;
}): HomeKpiAvailability {
  if (input.scope !== "shop_wide") {
    if (input.salesHydrating || !input.hydrationComplete) return "loading";
    return "ready";
  }
  if (input.overlayExpected) {
    if (input.overlayStatus === "loading" || input.overlayStatus === "idle") return "loading";
    if (input.overlayStatus === "unavailable") return "unavailable";
    if (!input.overlayHasMonth) return "unavailable";
    return "ready";
  }
  if (input.salesHydrating || !input.hydrationComplete) return "loading";
  return "ready";
}

/** 7-day spark is local-only — never treat a hydrating replica as a quiet week. */
export function resolveHomeWeekSparkAvailability(input: {
  salesHydrating: boolean;
  hydrationComplete: boolean;
}): HomeKpiAvailability {
  if (input.salesHydrating || !input.hydrationComplete) return "loading";
  return "ready";
}

export function presentHomeKpiStat(
  stat: HomeTileLiveStat,
  availability: HomeKpiAvailability,
  copy: { loading: string; unavailable: string },
): HomeTileLiveStat {
  if (availability === "ready") {
    return { ...stat, availability: "ready" };
  }
  return {
    ...stat,
    value: HOME_KPI_PLACEHOLDER,
    trend: availability === "loading" ? copy.loading : copy.unavailable,
    intensity: "calm" as HomeTileIntensity,
    availability,
  };
}

export function presentHomeKpiFormattedValue(
  formatted: string,
  availability: HomeKpiAvailability,
): string {
  return availability === "ready" ? formatted : HOME_KPI_PLACEHOLDER;
}

export function homeKpiAvailabilityHint(
  availability: HomeKpiAvailability,
  copy: { loading: string; unavailable: string },
): string | undefined {
  if (availability === "loading") return copy.loading;
  if (availability === "unavailable") return copy.unavailable;
  return undefined;
}
