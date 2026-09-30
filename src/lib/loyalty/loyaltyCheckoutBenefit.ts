/**
 * The checkout's view of a monetary reward (Phase E).
 *
 * THIS IS A PREVIEW, NOT AN AUTHORITY. The cashier sees what the reward is worth so the cart
 * can show a total before payment; the points are consumed and the benefit is recorded only
 * after the sale exists, and the SERVER derives the final amount from the redemption's own
 * snapshot. Nothing here can increase what a customer receives.
 *
 * It is the single place the preview arithmetic lives — the same rule the server applies
 * (`loyalty_apply_redemption_to_sale`): a fixed amount, or a floored percentage of the
 * eligible amount, clamped so a discount can never exceed the cart.
 */

import type { LoyaltyReward } from "./loyaltyRewards";

export type PendingLoyaltyBenefit = {
  shopId: string;
  accountId: string;
  rewardId: string;
  rewardName: string;
  pointsRequired: number;
  benefitKind: "fixed_discount" | "percentage_discount";
  /** What the cart is showing now. The server decides the final figure. */
  previewAmountUgx: number;
};

/** True when the reward gives a monetary benefit rather than a product. */
export function isMonetaryReward(reward: Pick<LoyaltyReward, "benefitKind">): boolean {
  return reward.benefitKind === "fixed_discount" || reward.benefitKind === "percentage_discount";
}

/**
 * What this reward is worth against a cart of `cartSubtotalUgx`.
 *
 * Returns 0 when the reward carries no monetary benefit, when the cart is empty, or when the
 * computed benefit rounds to nothing — in which case there is no discount to apply.
 */
export function previewBenefitAmountUgx(
  reward: Pick<LoyaltyReward, "benefitKind" | "benefitAmountUgx" | "benefitPercent">,
  cartSubtotalUgx: number,
): number {
  const subtotal = Math.max(0, Math.floor(Number(cartSubtotalUgx) || 0));
  if (subtotal <= 0) return 0;

  if (reward.benefitKind === "fixed_discount") {
    const amount = Math.floor(Number(reward.benefitAmountUgx ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.min(amount, subtotal);
  }

  if (reward.benefitKind === "percentage_discount") {
    const percent = Number(reward.benefitPercent ?? 0);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return 0;
    // Floored integer UGX, matching the server — never a fractional shilling.
    return Math.min(Math.floor((subtotal * percent) / 100), subtotal);
  }

  return 0;
}

/** How the benefit reads to a cashier: "UGX 5,000 off" / "10% off". */
export function benefitLabel(reward: Pick<LoyaltyReward, "benefitKind" | "benefitAmountUgx" | "benefitPercent">): string | null {
  if (reward.benefitKind === "fixed_discount" && reward.benefitAmountUgx != null) {
    return `UGX ${Number(reward.benefitAmountUgx).toLocaleString("en-US")} off`;
  }
  if (reward.benefitKind === "percentage_discount" && reward.benefitPercent != null) {
    return `${Number(reward.benefitPercent)}% off`;
  }
  return null;
}
