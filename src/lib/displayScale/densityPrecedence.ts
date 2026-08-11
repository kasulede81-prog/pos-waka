/**
 * Phase M1.1 — density stacking precedence for Sell.
 *
 * 1. Display Scale tokens (`--ds-*`) own typography, gaps, and touch mins.
 * 2. Shelf Scale may only nudge shelf-tile emphasis (dampened).
 * 3. OS Dynamic Type is resisted on the sell shell via `text-size-adjust: 100%`.
 */

import {
  dampenShelfScaleForDisplay,
  toCashierDensityLevel,
  type DisplayScaleLevel,
} from "./scaleTokens";

export type DensityPrecedence = {
  owner: "display_scale";
  cashierMode: "compact" | "balanced" | "comfortable";
  shelfScaleEffective: number;
};

export function resolveSellDensityPrecedence(
  displayLevel: DisplayScaleLevel,
  shelfScale: number,
): DensityPrecedence {
  const cashier = toCashierDensityLevel(displayLevel);
  return {
    owner: "display_scale",
    cashierMode: cashier === "compact" ? "compact" : cashier === "large" ? "comfortable" : "balanced",
    shelfScaleEffective: dampenShelfScaleForDisplay(shelfScale, displayLevel),
  };
}
