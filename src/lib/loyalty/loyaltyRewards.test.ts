import { describe, expect, it } from "vitest";
import {
  isRewardEligible,
  newRedemptionIdempotencyKey,
  validateRewardInput,
  type LoyaltyReward,
  type RewardInput,
} from "./loyaltyRewards";

/**
 * Phase 08 — Reward catalog validation + eligibility rules (pure functions).
 */

function baseInput(patch: Partial<RewardInput> = {}): RewardInput {
  return {
    name: "Free soda",
    description: "",
    pointsRequired: 10,
    rewardKind: "product",
    productId: null,
    productQuantity: 1,
    maxRedemptionsPerAccount: null,
    active: true,
    expiresOn: null,
    ...patch,
  };
}

function reward(patch: Partial<LoyaltyReward> = {}): LoyaltyReward {
  return {
    id: "r1",
    name: "Free soda",
    description: "",
    pointsRequired: 10,
    rewardKind: "product",
    productId: null,
    productQuantity: 1,
    maxRedemptionsPerAccount: null,
    active: true,
    sortOrder: 0,
    expiresOn: null,
    ...patch,
  };
}

describe("validateRewardInput", () => {
  it("accepts a minimal valid reward", () => {
    expect(validateRewardInput(baseInput())).toBeNull();
  });

  it("rewards require a non-empty name", () => {
    expect(validateRewardInput(baseInput({ name: "   " }))).toBe("name_required");
  });

  it("points required must be a positive integer", () => {
    expect(validateRewardInput(baseInput({ pointsRequired: 0 }))).toBe("invalid_points_required");
    expect(validateRewardInput(baseInput({ pointsRequired: -5 }))).toBe("invalid_points_required");
    expect(validateRewardInput(baseInput({ pointsRequired: 2.5 }))).toBe("invalid_points_required");
    expect(validateRewardInput(baseInput({ pointsRequired: Number.NaN }))).toBe(
      "invalid_points_required",
    );
  });

  it("max redemptions, when set, must be a positive integer", () => {
    expect(validateRewardInput(baseInput({ maxRedemptionsPerAccount: 1 }))).toBeNull();
    expect(validateRewardInput(baseInput({ maxRedemptionsPerAccount: 0 }))).toBe(
      "invalid_max_redemptions",
    );
    expect(validateRewardInput(baseInput({ maxRedemptionsPerAccount: -2 }))).toBe(
      "invalid_max_redemptions",
    );
    expect(validateRewardInput(baseInput({ maxRedemptionsPerAccount: 1.5 }))).toBe(
      "invalid_max_redemptions",
    );
  });
});

describe("isRewardEligible", () => {
  it("is eligible when active and the balance covers the cost", () => {
    expect(isRewardEligible(reward(), 10)).toBe(true);
    expect(isRewardEligible(reward(), 25)).toBe(true);
  });

  it("is not eligible when the balance is short", () => {
    expect(isRewardEligible(reward(), 9)).toBe(false);
    expect(isRewardEligible(reward(), 0)).toBe(false);
  });

  it("is not eligible when the reward is inactive", () => {
    expect(isRewardEligible(reward({ active: false }), 100)).toBe(false);
  });

  it("is not eligible when the reward is expired", () => {
    expect(isRewardEligible(reward({ expiresOn: "2020-01-01" }), 100)).toBe(false);
  });
});

describe("newRedemptionIdempotencyKey", () => {
  it("generates a unique non-empty key per intent", () => {
    const a = newRedemptionIdempotencyKey();
    const b = newRedemptionIdempotencyKey();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
