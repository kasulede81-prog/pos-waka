import type { SellingMode } from "../types";

/** Fixed sell-unit choices for the simple “add product” form (easy for shop owners). */
export const QUICK_ADD_SELL_UNITS = ["piece", "pack", "pair", "kg", "other"] as const;
export type QuickAddSellUnit = (typeof QUICK_ADD_SELL_UNITS)[number];

export function resolveQuickAddSellUnit(preset: string, custom: string): string {
  if (preset === "other") return custom.trim() || "piece";
  return preset;
}

export function sellUnitPresetFromBaseUnit(baseUnit: string): QuickAddSellUnit | "other" {
  const u = baseUnit.trim().toLowerCase();
  if (u === "piece" || u === "pack" || u === "pair" || u === "kg") return u;
  return "other";
}

/** Cost per selling unit from total pack price and current stock count. */
export function costPerUnitFromPackAndStock(packTotalUgx: number, stockQty: number): number | undefined {
  if (packTotalUgx > 0 && stockQty > 0) return Math.floor(packTotalUgx / stockQty);
  return undefined;
}

export function sellingModeFromSellUnit(unit: string): SellingMode {
  const s = unit.toLowerCase();
  if (/\b(kg|kilo|gram|gramme|litre|liter)\b/.test(s) || /^g$|^l$/.test(s)) return "weighted";
  return "unit";
}
