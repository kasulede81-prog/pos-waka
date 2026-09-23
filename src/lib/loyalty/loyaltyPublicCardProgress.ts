/**
 * Client-side reward progress helpers for the public loyalty card (B1).
 * Display-only — does not mutate rewards or enable redemption.
 */

import type { PublicCardReward } from "./loyaltyPublicCard";

export type RewardProgress =
  | { kind: "affordable"; rewardName: string; message: string }
  | { kind: "near"; rewardName: string; pointsAway: number; message: string };

/** Lowest points_required among active rewards (ties: first in list order). */
export function findCheapestReward(rewards: PublicCardReward[]): PublicCardReward | null {
  if (!rewards.length) return null;
  let cheapest = rewards[0]!;
  for (let i = 1; i < rewards.length; i++) {
    const r = rewards[i]!;
    if (r.points_required < cheapest.points_required) cheapest = r;
  }
  return cheapest;
}

export function isRewardAffordable(balancePoints: number, pointsRequired: number): boolean {
  return Math.max(0, Math.trunc(balancePoints)) >= Math.max(0, Math.trunc(pointsRequired));
}

/**
 * Progress copy against the cheapest active reward.
 * Returns null when there are no rewards (caller should hide the section).
 */
export function buildRewardProgress(
  balancePoints: number,
  rewards: PublicCardReward[],
): RewardProgress | null {
  const cheapest = findCheapestReward(rewards);
  if (!cheapest) return null;

  const balance = Math.max(0, Math.trunc(balancePoints));
  const needed = Math.max(0, Math.trunc(cheapest.points_required));
  const name = cheapest.name.trim() || "your next reward";

  if (balance >= needed) {
    return {
      kind: "affordable",
      rewardName: name,
      message: `You have enough points for ${name}`,
    };
  }

  const pointsAway = needed - balance;
  return {
    kind: "near",
    rewardName: name,
    pointsAway,
    message: `${pointsAway} point${pointsAway === 1 ? "" : "s"} to your next reward`,
  };
}
