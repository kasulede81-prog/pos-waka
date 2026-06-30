/** Standard Uganda shilling denominations for physical cash counting. */
export const UGX_DENOMINATIONS = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
] as const;

export type DenominationCounts = Record<number, number>;

export function emptyDenominationCounts(): DenominationCounts {
  const out: DenominationCounts = {};
  for (const d of UGX_DENOMINATIONS) out[d] = 0;
  return out;
}

export function sumDenominationCounts(counts: DenominationCounts): number {
  let total = 0;
  for (const d of UGX_DENOMINATIONS) {
    const qty = Math.max(0, Math.floor(counts[d] ?? 0));
    total += d * qty;
  }
  return total;
}

export function formatDenominationLabel(value: number): string {
  return value.toLocaleString();
}
