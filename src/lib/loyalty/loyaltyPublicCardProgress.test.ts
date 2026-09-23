import { describe, expect, it } from "vitest";
import {
  buildRewardProgress,
  findCheapestReward,
  isRewardAffordable,
} from "./loyaltyPublicCardProgress";
import type { PublicCardReward } from "./loyaltyPublicCard";

const rewards = (rows: Array<[string, number]>): PublicCardReward[] =>
  rows.map(([name, points_required]) => ({ name, points_required, description: null }));

describe("loyaltyPublicCardProgress", () => {
  it("finds the cheapest reward by points_required", () => {
    expect(findCheapestReward([])).toBeNull();
    expect(findCheapestReward(rewards([["Tea", 100], ["Sugar", 50], ["Soap", 75]]))?.name).toBe(
      "Sugar",
    );
  });

  it("marks rewards affordable vs locked by balance", () => {
    expect(isRewardAffordable(50, 50)).toBe(true);
    expect(isRewardAffordable(49, 50)).toBe(false);
    expect(isRewardAffordable(100, 50)).toBe(true);
  });

  it("returns null progress when there are no rewards", () => {
    expect(buildRewardProgress(100, [])).toBeNull();
  });

  it("shows affordable message when balance covers cheapest reward", () => {
    const progress = buildRewardProgress(405, rewards([["1kg Sugar", 300], ["Free soda", 500]]));
    expect(progress).toEqual({
      kind: "affordable",
      rewardName: "1kg Sugar",
      message: "You have enough points for 1kg Sugar",
    });
  });

  it("shows points-away message when balance is insufficient", () => {
    const progress = buildRewardProgress(405, rewards([["Free soda", 500]]));
    expect(progress).toEqual({
      kind: "near",
      rewardName: "Free soda",
      pointsAway: 95,
      message: "95 points to your next reward",
    });
  });

  it("uses singular point when one point away", () => {
    const progress = buildRewardProgress(99, rewards([["Soap", 100]]));
    expect(progress?.kind).toBe("near");
    if (progress?.kind === "near") {
      expect(progress.message).toBe("1 point to your next reward");
    }
  });
});
