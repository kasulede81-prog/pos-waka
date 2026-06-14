/** Resolve refund UGX from modal input — shared by ReturnProductModal and tests. */
export function resolveReturnRefundUgx(input: {
  refundInput: string;
  suggestedRefundUgx: number;
  maxRefundUgx: number | null;
}): { refundUgx: number; usedSuggestion: boolean; wasCapped: boolean } {
  const parsed = Math.floor(Number(input.refundInput.replace(/\D/g, "")) || 0);
  const usedSuggestion = parsed <= 0;
  let refundUgx = usedSuggestion ? input.suggestedRefundUgx : parsed;
  let wasCapped = false;
  if (input.maxRefundUgx != null && refundUgx > input.maxRefundUgx) {
    refundUgx = input.maxRefundUgx;
    wasCapped = true;
  }
  return { refundUgx, usedSuggestion, wasCapped };
}
