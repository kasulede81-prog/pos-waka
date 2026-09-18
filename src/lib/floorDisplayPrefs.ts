import type { HospitalityFloorDisplayPrefs, Sale, ShopPreferences } from "../types";

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

/**
 * Store slice for FloorPlanPage, meant for `useShallow`. Every value must be a
 * primitive or an existing store reference: `useShallow` compares top-level
 * values with Object.is, so a nested object literal here is a new reference on
 * every call and makes React loop forever (error #185).
 */
export function selectFloorPlanSlice(s: { preferences: ShopPreferences; sales: Sale[] }) {
  const display = resolveFloorDisplayPrefs(s.preferences);
  return {
    businessType: s.preferences.businessType,
    hospitalityModeEnabled: s.preferences.hospitalityModeEnabled,
    rawFloor: s.preferences.hospitalityFloor,
    sales: s.sales,
    tableShape: display.tableShape,
    tableSize: display.tableSize,
    gridDensity: display.gridDensity,
  };
}

export function resolveFloorDisplayPrefs(prefs: ShopPreferences): ResolvedFloorDisplayPrefs {
  return resolveFloorDisplay(prefs.hospitalityFloorDisplay);
}

/** Pure resolver over the raw stored value — select the raw value from the store, resolve in useMemo. */
export function resolveFloorDisplay(ext: HospitalityFloorDisplayPrefs | null | undefined): ResolvedFloorDisplayPrefs {
  return {
    tableShape: ext?.tableShape ?? DEFAULTS.tableShape,
    tableSize: ext?.tableSize ?? DEFAULTS.tableSize,
    gridDensity: ext?.gridDensity ?? DEFAULTS.gridDensity,
  };
}
