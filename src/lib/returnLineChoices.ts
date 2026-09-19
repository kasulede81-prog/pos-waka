/**
 * Which sale LINE a return comes from — the pure logic behind the return modal's line picker.
 *
 * A sale can hold several lines of the SAME product (another variant, other modifiers, a combo). The
 * modal used to key everything by product id: both lines shared one picker value, so the second line
 * could never be chosen and the first line was returned silently. The store and the cloud already bind a
 * return to a line (`saleLineId`); this lets the cashier say which one.
 *
 * With a single line per product (every ordinary retail sale) nothing changes: no picker is shown and
 * the one line is used.
 */

import type { ReturnRecord, Sale, SaleLine, SaleLineModifier } from "../types";
import { remainingReturnableQuantity } from "./returnLimits";

export type ReturnLineChoice = {
  /** The sale line's id (null only for a legacy line that never received one). */
  lineId: string | null;
  productId: string;
  /** What the line was sold as, e.g. "Burger (Large)". */
  name: string;
  /** Variant/modifier context beyond the name, e.g. "Extra cheese, No onion" (empty when none). */
  context: string;
  remainingQty: number;
  unitPriceUgx: number;
  lineTotalUgx: number;
  /** Nothing left to return on this line. */
  exhausted: boolean;
};

const modifierLabel = (m: SaleLineModifier): string => (m.optionLabel?.trim() || m.optionId || "").trim();

/** Modifier text for a line — only what the name does not already say (the name carries the variant). */
export function returnLineContext(line: Pick<SaleLine, "selectedModifiers" | "notes">): string {
  const mods = (line.selectedModifiers ?? []).map(modifierLabel).filter(Boolean);
  return mods.join(", ");
}

/** The lines of `productId` a return can still be taken from (voided lines are gone), in sale order. */
export function returnLineChoices(sale: Sale, productId: string, returnRecords: readonly ReturnRecord[]): ReturnLineChoice[] {
  return sale.lines
    .filter((l) => l.productId === productId && !l.voided)
    .map((l) => {
      const remainingQty = remainingReturnableQuantity(sale, productId, [...returnRecords], 0, l.id ?? null);
      return {
        lineId: l.id ?? null,
        productId,
        name: l.name,
        context: returnLineContext(l),
        remainingQty,
        unitPriceUgx: l.unitPriceUgx,
        lineTotalUgx: l.lineTotalUgx,
        exhausted: remainingQty <= 0,
      };
    });
}

/** The picker only appears when the cashier actually has a choice to make. */
export function needsReturnLineChoice(choices: readonly ReturnLineChoice[]): boolean {
  return choices.length > 1;
}

/** The line to preselect: the first one that still has something to return. */
export function defaultReturnLineId(choices: readonly ReturnLineChoice[]): string | null {
  return (choices.find((c) => !c.exhausted) ?? choices[0])?.lineId ?? null;
}

/**
 * The line id a return is submitted with: the cashier's pick when there is a real choice, otherwise the
 * only line. A pick that is no longer valid (exhausted, or not a line of this product) falls back to the
 * default instead of being sent.
 */
export function resolveReturnLineId(choices: readonly ReturnLineChoice[], picked: string | null): string | null {
  if (!choices.length) return null;
  if (!needsReturnLineChoice(choices)) return choices[0]!.lineId;
  const chosen = choices.find((c) => c.lineId === picked && !c.exhausted);
  return chosen ? chosen.lineId : defaultReturnLineId(choices);
}

/**
 * Products offered in the modal's product picker: one entry per PRODUCT (two lines of one product used to
 * produce two options with the same value and duplicate React keys). Single-line products keep the line's
 * own name; a product that appears on several lines is labelled with its product name, and the line picker
 * below tells the lines apart.
 */
export function returnProductPickList(
  sale: Sale,
  productNameById: (productId: string) => string | undefined,
): Array<{ id: string; name: string }> {
  const seen = new Map<string, { id: string; name: string; lines: number }>();
  for (const l of sale.lines) {
    if (l.voided) continue;
    const prev = seen.get(l.productId);
    if (prev) prev.lines += 1;
    else seen.set(l.productId, { id: l.productId, name: l.name, lines: 1 });
  }
  return [...seen.values()].map((e) => ({ id: e.id, name: e.lines > 1 ? productNameById(e.id) ?? e.name : e.name }));
}
