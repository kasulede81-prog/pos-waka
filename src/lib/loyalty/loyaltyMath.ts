/**
 * Loyalty domain types + pure calculation helpers (Phase 02).
 *
 * The database is the source of truth for awarding (see
 * supabase/migrations/20260918024500_loyalty_data_foundation.sql). These
 * helpers exist only for UI previews (e.g. "this sale will earn ~N points")
 * and offline estimates — they are never used to credit points.
 */

export type LoyaltyProgramConfig = {
  enabled: boolean;
  earnUnitUgx: number;
  earnPointsPerUnit: number;
  minEligibleSpendUgx: number;
};

export const DEFAULT_LOYALTY_PROGRAM: LoyaltyProgramConfig = {
  enabled: false,
  earnUnitUgx: 1000,
  earnPointsPerUnit: 1,
  minEligibleSpendUgx: 0,
};

export type LoyaltyAccountSnapshot = {
  id: string;
  shopId: string;
  customerId: string;
  status: "active" | "disabled";
  balancePoints: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
  qrToken: string;
  enrolledAt: string;
};

export type LoyaltyTransactionKind =
  | "earned"
  | "redeemed"
  | "reversed"
  | "expired"
  | "adjusted"
  | "promotional";

export type LoyaltyTransactionRow = {
  id: string;
  shopId: string;
  accountId: string;
  kind: LoyaltyTransactionKind;
  points: number;
  balanceAfter: number | null;
  cause: "sale" | "return" | "void" | "redemption" | "expiration" | "manual_adjustment" | "promotion" | "enrollment";
  sourceSaleId: string | null;
  sourceReturnId: string | null;
  sourceVoidId: string | null;
  reversalOfId: string | null;
  note: string | null;
  createdAt: string;
};

/** Mirrors loyalty_award_for_sale: floor((total - min) / unit) * perUnit. */
export function computeEarnedPoints(
  totalSpendUgx: number,
  config: LoyaltyProgramConfig,
): number {
  if (!config.enabled) return 0;
  if (!Number.isFinite(totalSpendUgx) || totalSpendUgx <= 0) return 0;
  if (config.earnUnitUgx <= 0 || config.earnPointsPerUnit <= 0) return 0;
  const eligible = Math.max(0, Math.floor(totalSpendUgx) - Math.max(0, config.minEligibleSpendUgx));
  return Math.floor(eligible / config.earnUnitUgx) * config.earnPointsPerUnit;
}

/** Mirror of the reversal cap: proportional, never more than outstanding. */
export function computeReturnReversalPoints(
  refundAmountUgx: number,
  outstandingPoints: number,
  config: LoyaltyProgramConfig,
): number {
  if (outstandingPoints <= 0) return 0;
  if (!Number.isFinite(refundAmountUgx) || refundAmountUgx <= 0) return 0;
  if (config.earnUnitUgx <= 0 || config.earnPointsPerUnit <= 0) return 0;
  const proportional = Math.floor(refundAmountUgx / config.earnUnitUgx) * config.earnPointsPerUnit;
  return Math.min(Math.max(proportional, 0), outstandingPoints);
}

/** Balance invariant enforced by the DB trigger. */
export function isBalanceConsistent(account: {
  balancePoints: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
}): boolean {
  return (
    account.balancePoints === account.lifetimeEarnedPoints - account.lifetimeRedeemedPoints
  );
}
