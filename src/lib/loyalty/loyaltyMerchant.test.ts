import { describe, expect, it } from "vitest";
import { validateProgramInput, type ProgramInput } from "./loyaltyMerchant";

/**
 * Phase 04 — Merchant program-input validation (client guard mirroring the
 * `loyalty_update_program` RPC checks so the UI flags bad input early).
 */

const VALID: ProgramInput = {
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

describe("validateProgramInput", () => {
  it("accepts the default valid input", () => {
    expect(validateProgramInput(VALID)).toBeNull();
  });

  it("rejects a non-positive earn unit", () => {
    expect(validateProgramInput({ ...VALID, earnUnitUgx: 0 })).toBe("invalid_earn_unit");
    expect(validateProgramInput({ ...VALID, earnUnitUgx: -500 })).toBe("invalid_earn_unit");
    expect(validateProgramInput({ ...VALID, earnUnitUgx: Number.NaN })).toBe("invalid_earn_unit");
    expect(validateProgramInput({ ...VALID, earnUnitUgx: Number.POSITIVE_INFINITY })).toBe(
      "invalid_earn_unit",
    );
  });

  it("rejects non-positive or non-integer points per unit", () => {
    expect(validateProgramInput({ ...VALID, earnPointsPerUnit: 0 })).toBe("invalid_points_per_unit");
    expect(validateProgramInput({ ...VALID, earnPointsPerUnit: -1 })).toBe("invalid_points_per_unit");
    expect(validateProgramInput({ ...VALID, earnPointsPerUnit: 1.5 })).toBe("invalid_points_per_unit");
  });

  it("rejects a negative minimum spend but accepts zero", () => {
    expect(validateProgramInput({ ...VALID, minEligibleSpendUgx: -1 })).toBe("invalid_min_spend");
    expect(validateProgramInput({ ...VALID, minEligibleSpendUgx: 0 })).toBeNull();
  });
});
