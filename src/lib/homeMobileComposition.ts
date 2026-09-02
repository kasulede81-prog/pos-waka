/**
 * HOME V8.1 — mobile cockpit tokens.
 * Presentation only. Desktop composition is unchanged.
 *
 * Active at ≤767px. 768px+ keeps the existing Home path.
 */

import type { ResolvedHomeTile } from "./launcherTiles";

export const HOME_MOBILE_MAX_PX = 767;

export const HOME_MOBILE_WORKSPACE_IDS = ["inventory", "cash", "cashPosition", "reports"] as const;

export const HOME_MOBILE_WORKSPACE_GRID =
  "home-mobile-workspace grid grid-cols-2 items-stretch gap-2 [grid-auto-rows:1fr]";

export const HOME_MOBILE_OPS_GRID =
  "home-mobile-ops grid grid-cols-2 items-stretch gap-2 [grid-auto-rows:1fr]";

export const HOME_MOBILE_TYPE = {
  greeting: "text-base font-bold tracking-tight",
  shop: "text-sm font-semibold text-muted-foreground",
  salesLabel: "text-[11px] font-bold uppercase tracking-wide text-muted-foreground",
  salesValue: "text-3xl font-black tabular-nums tracking-tight min-[390px]:text-4xl",
  section: "text-sm font-bold tracking-tight sm:text-base",
} as const;

export function homeGreetingKey(hour: number): string {
  if (hour < 12) return "desktopHomeGreetingMorning";
  if (hour < 17) return "desktopHomeGreetingAfternoon";
  return "desktopHomeGreetingEvening";
}

/** Inventory | Drawer / Cash Position | Reports — leftover primary tiles follow. */
export function composeMobileWorkspace(
  primary: readonly ResolvedHomeTile[],
  reports: ResolvedHomeTile | null,
): ResolvedHomeTile[] {
  const pool = [...primary, ...(reports ? [reports] : [])];
  const ordered: ResolvedHomeTile[] = [];
  for (const id of HOME_MOBILE_WORKSPACE_IDS) {
    const tile = pool.find((item) => item.id === id);
    if (tile) ordered.push(tile);
  }
  for (const tile of pool) {
    if (!ordered.some((item) => item.id === tile.id)) ordered.push(tile);
  }
  return ordered;
}
