import {
  resolveWakaLayoutBand,
  type WakaLayoutBand,
  WAKA_DESKTOP_MIN_PX,
  WAKA_MEDIA,
  WAKA_MOBILE_MAX_PX,
  WAKA_TABLET_MIN_PX,
} from "../../../lib/responsiveBreakpoints";
import type { InventoryViewMode } from "./types";

export { WAKA_DESKTOP_MIN_PX, WAKA_MOBILE_MAX_PX, WAKA_TABLET_MIN_PX, WAKA_MEDIA };

export function resolveLayoutBand(widthPx: number): WakaLayoutBand {
  return resolveWakaLayoutBand(widthPx);
}

/** Default view when preference is `auto`. */
export function defaultViewForBand(band: WakaLayoutBand): InventoryViewMode {
  if (band === "mobile") return "compact";
  if (band === "tablet") return "card";
  return "table";
}

export function isTableViewAllowed(widthPx: number): boolean {
  return widthPx >= WAKA_DESKTOP_MIN_PX;
}
