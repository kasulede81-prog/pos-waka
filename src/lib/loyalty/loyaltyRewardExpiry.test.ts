import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafePublicCardJson } from "../../../supabase/functions/_shared/loyaltyWallet/publicCardTypes.ts";
import {
  isRewardEligible,
  isRewardUnexpiredClient,
  validateRewardInput,
  type LoyaltyReward,
  type RewardInput,
} from "./loyaltyRewards";

function baseInput(patch: Partial<RewardInput> = {}): RewardInput {
  return {
    name: "Free soda",
    description: "",
    pointsRequired: 10,
    rewardKind: "custom",
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
    rewardKind: "custom",
    productId: null,
    productQuantity: 1,
    maxRedemptionsPerAccount: null,
    active: true,
    sortOrder: 0,
    expiresOn: null,
    ...patch,
  };
}

describe("C2 reward expiry client helpers", () => {
  it("validateRewardInput accepts null expiry and YYYY-MM-DD", () => {
    expect(validateRewardInput(baseInput())).toBeNull();
    expect(validateRewardInput(baseInput({ expiresOn: "2027-12-31" }))).toBeNull();
    expect(validateRewardInput(baseInput({ expiresOn: "31/12/2027" }))).toBe(
      "invalid_reward_expires_on",
    );
  });

  it("isRewardUnexpiredClient: null never expires; Kampala inclusive day", () => {
    expect(isRewardUnexpiredClient(null)).toBe(true);
    const onDay = Date.parse("2027-12-31T12:00:00+03:00");
    const after = Date.parse("2028-01-01T00:00:00+03:00");
    expect(isRewardUnexpiredClient("2027-12-31", onDay)).toBe(true);
    expect(isRewardUnexpiredClient("2027-12-31", after)).toBe(false);
  });

  it("isRewardEligible requires active + unexpired + balance", () => {
    expect(isRewardEligible(reward(), 10)).toBe(true);
    expect(isRewardEligible(reward({ active: false }), 100)).toBe(false);
    expect(isRewardEligible(reward({ expiresOn: "2020-01-01" }), 100)).toBe(false);
    expect(isRewardEligible(reward({ expiresOn: "2035-01-01" }), 5)).toBe(false);
  });

  it("public card filters expired rewards server-side and keeps allowlist", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/_shared/loyaltyWallet/publicCardLookup.ts"),
      "utf8",
    );
    expect(src).toMatch(/isRewardUnexpiredForPublic/);
    expect(src).toMatch(/expires_on/);
    expect(src).toMatch(/\.filter\(/);
    expect(() =>
      assertSafePublicCardJson({
        ok: true,
        rewards: [{ name: "Soda", points_required: 10, description: null }],
      }),
    ).not.toThrow();
    expect(() =>
      assertSafePublicCardJson({
        ok: true,
        rewards: [],
        account_id: "x",
      }),
    ).toThrow(/unsafe_public_card_field/);
  });

  it("Wallet issuer source remains free of reward-catalog expiry changes", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/loyalty-public-wallet-issue/index.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/expires_on/);
    expect(src).not.toMatch(/reward_expired/);
  });
});
