import type { Product, SaleLine } from "../types";
import { mergeDraftSaleLine } from "./draftCart";
import { buildConfiguredSaleLine } from "./menuModifiers";

/**
 * Merge `incoming` into `existing` (same merge key) without losing hospitality configuration.
 *
 * - Plain lines go through the shared retail cart merge (mergeDraftSaleLine) — retail is the
 *   source of truth for quantity/price/cost handling.
 * - Configured lines (modifiers / variant) are rebuilt WITH their configuration: the retail
 *   rebuild is a plain product line and silently dropped modifier prices and kitchen notes.
 * - Combo lines are never merged (their price is built from their slots).
 *
 * Returns null when the two lines must stay separate.
 */
export function mergeHospitalityDraftLine(
  existing: SaleLine,
  incoming: SaleLine,
  product: Product,
  opts?: { keepDiscountedSeparate?: boolean },
): SaleLine | null {
  if (existing.isComboMeal || existing.comboSelections?.length) return null;
  if (opts?.keepDiscountedSeparate && (isDiscounted(existing) || isDiscounted(incoming))) return null;

  const configured = Boolean(existing.selectedModifiers?.length || existing.variantId);
  if (!configured) return mergeDraftSaleLine(existing, incoming, product);

  const rebuilt = buildConfiguredSaleLine({
    product,
    quantity: existing.quantity + incoming.quantity,
    variantId: existing.variantId,
    modifiers: existing.selectedModifiers,
    notes: existing.notes,
    course: existing.course,
    seatNumber: existing.seatNumber,
  });
  if (!rebuilt.line) return opts?.keepDiscountedSeparate ? null : mergeDraftSaleLine(existing, incoming, product);
  return {
    ...rebuilt.line,
    id: existing.id,
    stockVersionAtAdd: existing.stockVersionAtAdd ?? rebuilt.line.stockVersionAtAdd,
  };
}

function isDiscounted(line: SaleLine): boolean {
  return (line.discountUgx ?? 0) > 0 || (line.originalLineTotalUgx ?? line.lineTotalUgx) > line.lineTotalUgx;
}
