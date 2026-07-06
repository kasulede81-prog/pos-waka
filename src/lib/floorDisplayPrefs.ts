import type { HospitalityFloorDisplayPrefs, ShopPreferences } from "../types";

export type ResolvedFloorDisplayPrefs = {
  tableShape: NonNullable<HospitalityFloorDisplayPrefs["tableShape"]>;
  tableSize: NonNullable<HospitalityFloorDisplayPrefs["tableSize"]>;
  gridDensity: NonNullable<HospitalityFloorDisplayPrefs["gridDensity"]>;
};

const DEFAULTS: ResolvedFloorDisplayPrefs = {
  tableShape: "classic",
  tableSize: "md",
  gridDensity: "normal",
};

/** Pixel footprint for the table icon (classic shape). */
export const TABLE_ICON_PX: Record<ResolvedFloorDisplayPrefs["tableSize"], number> = {
  sm: 64,
  md: 88,
  lg: 112,
  xl: 140,
};

/** Tailwind grid column classes per density (at lg breakpoint). */
export const FLOOR_GRID_CLASS: Record<ResolvedFloorDisplayPrefs["gridDensity"], string> = {
  compact: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7",
  normal: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
  spacious: "grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4",
};

export function resolveFloorDisplayPrefs(prefs: ShopPreferences): ResolvedFloorDisplayPrefs {
  const ext = prefs.hospitalityFloorDisplay;
  return {
    tableShape: ext?.tableShape ?? DEFAULTS.tableShape,
    tableSize: ext?.tableSize ?? DEFAULTS.tableSize,
    gridDensity: ext?.gridDensity ?? DEFAULTS.gridDensity,
  };
}
