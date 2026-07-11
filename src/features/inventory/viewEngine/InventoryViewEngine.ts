import { defaultViewForBand, isTableViewAllowed, resolveLayoutBand } from "./InventoryResponsiveLayout";
import { readInventoryViewPreference } from "./InventoryViewPersistence";
import type { ShopPreferences } from "../../../types";
import type { InventoryViewMode, InventoryViewPreference } from "./types";

export type ResolveInventoryViewInput = {
  viewportWidthPx: number;
  preference?: InventoryViewPreference;
  preferences?: ShopPreferences;
};

export function resolveInventoryViewMode(input: ResolveInventoryViewInput): InventoryViewMode {
  const band = resolveLayoutBand(input.viewportWidthPx);
  const preference =
    input.preference ?? (input.preferences ? readInventoryViewPreference(input.preferences) : "auto");

  if (preference === "auto") {
    return defaultViewForBand(band);
  }
  if (preference === "table" && !isTableViewAllowed(input.viewportWidthPx)) {
    return band === "mobile" ? "compact" : "card";
  }
  return preference;
}

export function inventoryViewEngineMeta(viewportWidthPx: number, mode: InventoryViewMode) {
  return {
    band: resolveLayoutBand(viewportWidthPx),
    mode,
    rowEstimatePx: mode === "card" ? 110 : mode === "compact" ? 68 : 44,
  };
}
