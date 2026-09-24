import { describe, expect, it } from "vitest";
import {
  computeEarnedPoints,
  computeReturnReversalPoints,
  DEFAULT_LOYALTY_PROGRAM,
  isBalanceConsistent,
  type LoyaltyProgramConfig,
} from "./loyaltyMath";

const program: LoyaltyProgramConfig = {
  enabled: true,
  earnUnitUgx: 1000,
  earnPointsPerUnit: 1,
  minEligibleSpendUgx: 0,
  membershipExpiryMode: "never",
  membershipFixedExpiresOn: null,
  membershipDurationMonths: null,
  pointsExpiryMode: "never",
  pointsExpiryMonths: null,
};

describe("computeEarnedPoints (mirror of loyalty_award_for_sale)", () => {
  it("awards floor(total / unit) points", () => {
    expect(computeEarnedPoints(35_000, program)).toBe(35);
    expect(computeEarnedPoints(999, program)).toBe(0);
    expect(computeEarnedPoints(1000, program)).toBe(1);
  });

  it("applies the multiplier", () => {
    expect(computeEarnedPoints(10_000, { ...program, earnPointsPerUnit: 2 })).toBe(20);
  });

  it("subtracts min eligible spend before dividing", () => {
    const withMin = { ...program, minEligibleSpendUgx: 5000 };
    expect(computeEarnedPoints(4000, withMin)).toBe(0);
    expect(computeEarnedPoints(7000, withMin)).toBe(2);
  });

  it("never awards when disabled or on invalid input", () => {
    expect(computeEarnedPoints(50_000, DEFAULT_LOYALTY_PROGRAM)).toBe(0);
    expect(computeEarnedPoints(0, program)).toBe(0);
    expect(computeEarnedPoints(-5, program)).toBe(0);
    expect(computeEarnedPoints(Number.NaN, program)).toBe(0);
    expect(computeEarnedPoints(10_000, { ...program, earnUnitUgx: 0 })).toBe(0);
  });
});

describe("computeReturnReversalPoints (mirror of loyalty_reverse_for_return)", () => {
  it("reverses proportionally and caps at outstanding", () => {
    expect(computeReturnReversalPoints(10_000, 35, program)).toBe(10);
    expect(computeReturnReversalPoints(10_000, 5, program)).toBe(5);
    expect(computeReturnReversalPoints(500, 35, program)).toBe(0);
    expect(computeReturnReversalPoints(10_000, 0, program)).toBe(0);
  });
});

describe("isBalanceConsistent", () => {
  it("holds when balance = earned - redeemed", () => {
    expect(
      isBalanceConsistent({ balancePoints: 25, lifetimeEarnedPoints: 35, lifetimeRedeemedPoints: 10 }),
    ).toBe(true);
    expect(
      isBalanceConsistent({ balancePoints: 30, lifetimeEarnedPoints: 35, lifetimeRedeemedPoints: 10 }),
    ).toBe(false);
  });
});
