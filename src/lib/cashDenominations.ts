/** Standard Uganda shilling denominations for physical cash counting. */
export const UGX_DENOMINATIONS = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
] as const;

/**
 * Checkout tender helper only — Ugandan banknotes a cashier taps into `cashInput`.
 * Do not use this list for drawer counting (that still uses `UGX_DENOMINATIONS`).
 * Matches `applyCheckoutNumericKey` 10-digit cap.
 */
export const UGX_CHECKOUT_NOTE_DENOMINATIONS = [50_000, 20_000, 10_000, 5_000, 2_000, 1_000] as const;

/**
 * Checkout tender helper only — circulating Ugandan coins a cashier taps into `cashInput`.
 * Do not use this list for drawer counting (that still uses `UGX_DENOMINATIONS`).
 * 1,000 remains a banknote in the checkout picker (BoU also publishes a 1,000 coin).
 */
export const UGX_CHECKOUT_COIN_DENOMINATIONS = [500, 200, 100] as const;

/** Local `public/` path for the checkout note-picker image (front of the 2010 BoU note). */
export function checkoutNoteAssetPath(denom: number): string {
  return `currency/ugx/ugx-${denom}-front.webp`;
}

/** Local `public/` path for the checkout coin-picker image (denomination face). */
export function checkoutCoinAssetPath(denom: number): string {
  return `currency/ugx/ugx-${denom}-coin.webp`;
}

const CHECKOUT_CASH_INPUT_MAX = 9_999_999_999;

/** Add one note or coin to the existing checkout cash digit string. `cashInput` stays the source of truth. */
export function addDenominationToCashInput(current: string, denom: number): string {
  const add = Math.max(0, Math.floor(denom));
  if (add <= 0) return String(current ?? "").replace(/\D/g, "").slice(0, 10);
  const currentAmt = Math.max(0, Math.floor(Number(String(current ?? "").replace(/\D/g, "")) || 0));
  const next = currentAmt + add;
  if (!Number.isFinite(next)) return String(currentAmt);
  return String(Math.min(next, CHECKOUT_CASH_INPUT_MAX));
}

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
