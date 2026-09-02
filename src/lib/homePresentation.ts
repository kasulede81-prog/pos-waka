import { homeModuleBand } from "./homeModulePriority";
import {
  resolveHomeMenuTiles,
  type ResolvedHomeTile,
} from "./launcherTiles";
import type { LauncherTileConfig, Permission } from "../types";
import { WAKA_DESKTOP_MIN_PX, WAKA_POS_WIDE_MIN_PX } from "./responsiveBreakpoints";

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
 * HOME CINEMATIC V3.1 — desktop Home measure.
 * Tailwind `max-w-[160rem]` = 2560px (4K cap only). 1280–1920 are full-bleed minus gutters.
 *
 * AppShell keeps `max-w-none` on `/`; this token is Home-only and wins inside Outlet.
 */
export const HOME_CONTENT_MAX_WIDTH_PX = 2560;
export const HOME_CONTENT_MEASURE_CLASS = "mx-auto w-full max-w-[160rem]";
export const HOME_PAGE_GUTTER_CLASS = "px-4 py-2 sm:px-5 sm:py-2.5 lg:px-5 lg:py-2.5 xl:px-6";
export const HOME_FOOTER_GUTTER_CLASS = "px-4 py-2 sm:px-5 lg:px-5 xl:px-6";

/** Horizontal padding (both sides) matching HOME_PAGE_GUTTER_CLASS. */
export function homePageGutterXPx(viewportWidth: number): number {
  if (viewportWidth >= 1280) return 24 * 2;
  if (viewportWidth >= 1024) return 20 * 2;
  if (viewportWidth >= 640) return 20 * 2;
  return 16 * 2;
}

/** Inner content width after gutters and the content measure. */
export function homeContentInnerWidthPx(viewportWidth: number): number {
  const gutter = homePageGutterXPx(viewportWidth);
  return Math.min(Math.max(0, viewportWidth - gutter), HOME_CONTENT_MAX_WIDTH_PX - gutter);
}

/** Grid classes shared by live Home and Settings preview — do not diverge. */
export const HOME_MODULE_GRID_CLASS = {
  comfortable:
    "grid auto-rows-fr grid-cols-2 items-stretch gap-2 sm:gap-2.5 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
  compact:
    "grid auto-rows-fr grid-cols-2 items-stretch gap-1.5 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
  /** Primary work beside Live Engine — equal 2-col tracks, last odd tile spans. */
  command:
    "grid auto-rows-fr grid-cols-2 items-stretch gap-2 sm:gap-2.5",
} as const;

/** Conventional 2-col primary grid. No row-span bento — 3 modules stay readable. */
export function homeCommandPrimaryGridClass(): string {
  return HOME_MODULE_GRID_CLASS.command;
}

export function homeCommandPrimaryItemClass(index?: number, count?: number): string {
  if (index != null && count != null && count % 2 === 1 && index === count - 1) {
    return "min-w-0 sm:col-span-2";
  }
  return "min-w-0";
}

export const HOME_MODULE_SECTION_SPACING = {
  standard: "mb-3",
  admin: "mb-1.5",
} as const;

/**
 * HOME CINEMATIC V2 — first-screen body regions (greeting lives on DesktopHomePage).
 * Large screens fold KPI + Health into the Living Business Pulse (hero).
 * DOM order must match this list so keyboard focus follows the visual scan.
 */
export type HomeBodyRegionId =
  | "hero"
  | "kpi"
  | "health"
  | "primary"
  | "reports"
  | "operations"
  | "admin";

export const HOME_REGION_ORDER_SMALL: readonly HomeBodyRegionId[] = [
  "hero",
  "primary",
  "reports",
  "kpi",
  "health",
  "operations",
  "admin",
];

export const HOME_REGION_ORDER_LARGE: readonly HomeBodyRegionId[] = [
  "hero",
  "primary",
  "reports",
  "operations",
  "admin",
];

/** Tile regions Settings can preview. KPI/Health are live-only chrome, filtered from this list. */
export const HOME_SETTINGS_PREVIEW_REGIONS: readonly HomeBodyRegionId[] = [
  "hero",
  "primary",
  "reports",
  "operations",
  "admin",
];

export type HomeRegionLayout = {
  largeScreen: boolean;
  /** KPI | Health two-column pack — only 1024–1279 where 2-row KPI still clips Primary. */
  packExecutiveScan: boolean;
};

export function resolveHomeRegionLayout(widthPx: number): HomeRegionLayout {
  const largeScreen = widthPx >= WAKA_DESKTOP_MIN_PX;
  return {
    largeScreen,
    packExecutiveScan: largeScreen && widthPx < WAKA_POS_WIDE_MIN_PX,
  };
}

export function resolveHomeRegionOrder(largeScreen: boolean): HomeBodyRegionId[] {
  return [...(largeScreen ? HOME_REGION_ORDER_LARGE : HOME_REGION_ORDER_SMALL)];
}

export function resolveHomeFirstScreenOrder(largeScreen: boolean): Array<"greeting" | HomeBodyRegionId> {
  return ["greeting", ...resolveHomeRegionOrder(largeScreen)];
}

export function resolveHomeSettingsRegionOrder(largeScreen: boolean): HomeBodyRegionId[] {
  const allowed = new Set<HomeBodyRegionId>(HOME_SETTINGS_PREVIEW_REGIONS);
  return resolveHomeRegionOrder(largeScreen).filter((id) => allowed.has(id));
}

export type VisibleHomeRegionFlags = {
  largeScreen: boolean;
  hasHero: boolean;
  hasKpis: boolean;
  hasHealth: boolean;
  hasPrimary: boolean;
  hasReports: boolean;
  hasOperations: boolean;
  hasAdmin: boolean;
};

export function visibleHomeRegionOrder(flags: VisibleHomeRegionFlags): HomeBodyRegionId[] {
  const include: Record<HomeBodyRegionId, boolean> = {
    hero: flags.hasHero,
    kpi: flags.hasKpis,
    health: flags.hasHealth,
    primary: flags.hasPrimary,
    reports: flags.hasReports,
    operations: flags.hasOperations,
    admin: flags.hasAdmin,
  };
  return resolveHomeRegionOrder(flags.largeScreen).filter((id) => include[id]);
}

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
