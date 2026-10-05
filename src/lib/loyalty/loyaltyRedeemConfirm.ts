import type { Language } from "../../types";
import { t, tTemplate } from "../i18n";

/**
 * Pure UI helpers for the merchant redemption confirmation dialog (Phase 2, Batch 2).
 *
 * PREVIEW AND DISPLAY ONLY. Every value here is what the member WILL see after the
 * server confirms a redemption — the authoritative balance always comes back from
 * `loyalty_redeem_reward`. Nothing in this module writes to, or reasons about, the
 * ledger; redemption accounting stays entirely server-side.
 */

/** Points still required for a reward (0 when affordable). */
export function pointsStillNeeded(pointsRequired: number, balancePoints: number): number {
  return Math.max(0, pointsRequired - balancePoints);
}

/** Preview of the balance after redeeming — never negative, never authoritative. */
export function balanceAfterRedeem(balancePoints: number, pointsRequired: number): number {
  return Math.max(0, balancePoints - pointsRequired);
}

/**
 * Merchant-facing message for a `loyalty_redeem_reward` error code.
 * Same mapping the member card has always shown — extracted so the confirmation
 * dialog and the card cannot drift apart.
 */
export function redeemErrorMessage(
  lang: Language,
  code: string,
  balance?: number,
  required?: number,
): string {
  if (code === "insufficient_points") {
    return tTemplate(lang, "loyaltyInsufficientPoints", {
      balance: balance ?? 0,
      required: required ?? 0,
    });
  }
  if (code === "redemption_limit_reached") return t(lang, "loyaltyRedeemLimitReached");
  if (code === "reward_expired") return t(lang, "loyaltyRewardExpiredRedeem");
  if (code === "membership_expired") return t(lang, "loyaltyMembershipExpiredRedeem");
  return t(lang, "loyaltyRedeemFailed");
}
