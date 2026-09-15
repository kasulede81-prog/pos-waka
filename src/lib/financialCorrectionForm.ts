import type { CorrectionBasis, CorrectionFinancialValues } from "./financialCorrectionApi";

export type PackCostCorrectionInput = {
  quantity: number;
  packCostUgx: number;
  conversionRate: number;
};

/**
 * Derives the corrected unit cost / COGS / gross profit from pack-cost + conversion-rate
 * evidence — the exact basis proven deterministic for all 11 lines in the approved
 * correction batch (packCostUgx ÷ conversionRate × quantity). Revenue is required only to
 * compute gross profit; it is never itself corrected.
 */
export function deriveCorrectionFromPackCost(
  input: PackCostCorrectionInput,
  revenueUgx: number,
): { corrected: CorrectionFinancialValues; basis: CorrectionBasis } {
  const unitCostUgx = Math.round((input.packCostUgx / input.conversionRate) * 100) / 100;
  const cogsUgx = Math.round(unitCostUgx * input.quantity);
  const grossProfitUgx = revenueUgx - cogsUgx;
  return {
    corrected: { unitCostUgx, cogsUgx, grossProfitUgx, estimatedProfitUgx: grossProfitUgx },
    basis: {
      basisType: "pack_cost_conversion",
      packCostUgx: input.packCostUgx,
      conversionRate: input.conversionRate,
    },
  };
}

export type CorrectionFormValidationError =
  | "reason_required"
  | "reason_too_short"
  | "negative_cost"
  | "cost_unchanged";

/**
 * Client-side pre-check only — the RPC re-validates everything server-side (§ the
 * correction RPC's own validation, which is authoritative). This exists purely to give
 * the admin immediate feedback before submitting, per "Do not provide a generic fix
 * data mechanism" — the form must require a real reason and cannot submit a no-op.
 */
export function validateCorrectionForm(input: {
  reason: string;
  before: CorrectionFinancialValues;
  corrected: CorrectionFinancialValues;
}): CorrectionFormValidationError | null {
  const reason = input.reason.trim();
  if (reason.length === 0) return "reason_required";
  if (reason.length < 3) return "reason_too_short";
  if (input.corrected.unitCostUgx < 0 || input.corrected.cogsUgx < 0) return "negative_cost";
  if (
    input.before.cogsUgx === input.corrected.cogsUgx &&
    input.before.unitCostUgx === input.corrected.unitCostUgx
  ) {
    return "cost_unchanged";
  }
  return null;
}
