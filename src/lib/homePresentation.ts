import { homeModuleBand } from "./homeModulePriority";
import {
  resolveHomeMenuTiles,
  type ResolvedHomeTile,
} from "./launcherTiles";
import type { LauncherTileConfig, Permission } from "../types";

export type HomePresentation = {
  hero: ResolvedHomeTile | null;
  reports: ResolvedHomeTile | null;
  primary: ResolvedHomeTile[];
  secondary: ResolvedHomeTile[];
  admin: ResolvedHomeTile[];
};

/** Stable id snapshot for Settings vs live structure comparisons. */
export type HomePresentationStructure = {
  heroId: string | null;
  reportsId: string | null;
  reportsRenderer: "HomeReportsPreview" | null;
  heroLocked: boolean;
  primaryIds: string[];
  secondaryIds: string[];
  adminIds: string[];
};

/**
 * HOME-DENSITY-1.1 — centered Home content measure (HD-01).
 * Tailwind `max-w-7xl` = 80rem = 1280px at default 16px root.
 *
 * Applied on the same box as Home gutters so:
 * - below 1024px: never binds (phone / tablet portrait unchanged)
 * - 1280x720: inner width matches the previous full-bleed layout
 * - 1440x900 / 1920x1080: 4-col cards stop stretching with the window
 *
 * AppShell keeps `max-w-none` on `/`; this token is Home-only and wins inside Outlet.
 */
export const HOME_CONTENT_MAX_WIDTH_PX = 1280;
export const HOME_CONTENT_MEASURE_CLASS = "mx-auto w-full max-w-7xl";
export const HOME_PAGE_GUTTER_CLASS = "px-4 py-4 sm:px-8 sm:py-6 lg:px-10 xl:px-14";
export const HOME_FOOTER_GUTTER_CLASS = "px-4 py-3 sm:px-8 lg:px-10 xl:px-14";

/** Horizontal padding (both sides) matching HOME_PAGE_GUTTER_CLASS. */
export function homePageGutterXPx(viewportWidth: number): number {
  if (viewportWidth >= 1280) return 56 * 2;
  if (viewportWidth >= 1024) return 40 * 2;
  if (viewportWidth >= 640) return 32 * 2;
  return 16 * 2;
}

/** Inner content width after gutters and the 1280px measure. */
export function homeContentInnerWidthPx(viewportWidth: number): number {
  const gutter = homePageGutterXPx(viewportWidth);
  return Math.min(Math.max(0, viewportWidth - gutter), HOME_CONTENT_MAX_WIDTH_PX - gutter);
}

/** Grid classes shared by live Home and Settings preview — do not diverge. */
export const HOME_MODULE_GRID_CLASS = {
  comfortable:
    "grid auto-rows-min grid-cols-2 items-start gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4",
  compact: "grid auto-rows-min grid-cols-2 items-start gap-2 sm:gap-2.5 lg:grid-cols-4 xl:grid-cols-5",
} as const;

export const HOME_MODULE_SECTION_SPACING = {
  standard: "mb-4 sm:mb-5",
  admin: "mb-2",
} as const;

/**
 * Phase 34.1 live Home composition: Sell hero, dedicated Reports card,
 * then Primary / Secondary / Admin bands. Reports is extracted before banding
 * even though `homeModuleBand("reports")` is `"primary"`.
 */
export function presentHomeMenuTiles(resolved: {
  hero: ResolvedHomeTile | null;
  secondary: ResolvedHomeTile[];
}): HomePresentation {
  const reports = resolved.secondary.find((tile) => tile.id === "reports") ?? null;
  const moduleTiles = resolved.secondary.filter((tile) => tile.id !== "reports");
  return {
    hero: resolved.hero,
    reports,
    primary: moduleTiles.filter((tile) => homeModuleBand(tile.id) === "primary"),
    secondary: moduleTiles.filter((tile) => homeModuleBand(tile.id) === "secondary"),
    admin: moduleTiles.filter((tile) => homeModuleBand(tile.id) === "admin"),
  };
}

export function resolveHomePresentation(params: {
  savedOrder: string[];
  layout: Record<string, LauncherTileConfig>;
  hasPermission: (perm?: Permission) => boolean;
  badges?: Record<string, number | undefined>;
  includeHidden?: boolean;
  pharmacyMode?: boolean;
}): HomePresentation {
  return presentHomeMenuTiles(resolveHomeMenuTiles(params));
}

export function homePresentationStructure(presentation: HomePresentation): HomePresentationStructure {
  return {
    heroId: presentation.hero?.id ?? null,
    reportsId: presentation.reports?.id ?? null,
    reportsRenderer: presentation.reports ? "HomeReportsPreview" : null,
    heroLocked: presentation.hero?.id === "sell",
    primaryIds: presentation.primary.map((tile) => tile.id),
    secondaryIds: presentation.secondary.map((tile) => tile.id),
    adminIds: presentation.admin.map((tile) => tile.id),
  };
}

/** Visible tiles only — Settings (includeHidden) vs live must match after filtering. */
export function visibleHomePresentationStructure(
  presentation: HomePresentation,
): HomePresentationStructure {
  const visible = (tiles: ResolvedHomeTile[]) => tiles.filter((tile) => !tile.hidden);
  return homePresentationStructure({
    hero: presentation.hero,
    reports: presentation.reports && !presentation.reports.hidden ? presentation.reports : null,
    primary: visible(presentation.primary),
    secondary: visible(presentation.secondary),
    admin: visible(presentation.admin),
  });
}

/**
 * Reorder one Home band in place inside the full secondary order.
 * IDs not in `nextBandOrder` keep their positions — cross-band moves are impossible.
 */
export function applyHomeBandOrder(fullOrder: string[], nextBandOrder: string[]): string[] {
  if (nextBandOrder.length === 0) return fullOrder;
  const bandSet = new Set(nextBandOrder);
  let i = 0;
  return fullOrder.map((id) => {
    if (!bandSet.has(id)) return id;
    const next = nextBandOrder[i];
    i += 1;
    return next ?? id;
  });
}
