/**
 * Hospitality ingredient low-stock policy — a shop-level threshold stored in
 * `preferences.hospitalityIngredientPolicy.lowStockThreshold`.
 *
 * It is a fallback only: a positive per-product `minimumStockAlert` always wins,
 * and products without a configured buying/stock threshold keep their existing
 * behavior. The policy applies only in Hospitality mode and only to recipe
 * ingredients (`ingredient` / `semi_finished`). Retail and pharmacy never read it.
 *
 * Kept dependency-free so `sellingEngine.isLowStock` can consume it without
 * pulling the store or the hospitality feature modules into a cycle.
 */

export type HospitalityLowStockPolicyContext = {
  /** Hospitality mode is active for this shop. */
  enabled: boolean;
  /** Validated positive finite threshold, or null when unset/invalid. */
  threshold: number | null;
};

let current: HospitalityLowStockPolicyContext = { enabled: false, threshold: null };
let revision = 0;

function sanitizeThreshold(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Apply the saved setting. Missing/zero/negative/non-finite thresholds (and
 * non-Hospitality shops) disable the policy rather than inventing a default.
 */
export function applyHospitalityLowStockPolicy(input: {
  hospitalityMode: boolean;
  lowStockThreshold: number | null | undefined;
}): void {
  const enabled = input.hospitalityMode === true;
  const threshold = enabled ? sanitizeThreshold(input.lowStockThreshold) : null;
  if (current.enabled === enabled && current.threshold === threshold) return;
  current = { enabled, threshold };
  revision += 1;
}

export function getHospitalityLowStockPolicyContext(): HospitalityLowStockPolicyContext {
  return current;
}

export function getHospitalityLowStockPolicyRevision(): number {
  return revision;
}

/** Stable token for memo/cache fingerprints that depend on the effective policy. */
export function hospitalityLowStockPolicyToken(): string {
  return current.enabled ? `h:${current.threshold ?? "none"}` : "none";
}

/** Test/account-reset helper: back to the safe retail default. */
export function resetHospitalityLowStockPolicyContext(): void {
  if (!current.enabled && current.threshold == null) return;
  current = { enabled: false, threshold: null };
  revision += 1;
}
