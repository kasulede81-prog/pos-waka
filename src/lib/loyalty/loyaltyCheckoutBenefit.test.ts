import { describe, expect, it } from "vitest";
import {
  benefitLabel,
  isMonetaryReward,
  previewBenefitAmountUgx,
} from "./loyaltyCheckoutBenefit";

/**
 * The checkout's benefit preview (Phase E).
 *
 * This is the ONLY place the cart computes a discount, and it exists so the cashier can show
 * a total before payment. It is a preview: the server derives the authoritative figure from
 * the redemption's snapshot at application time. These tests pin the arithmetic to the same
 * rule the server applies — fixed amount, or floored percentage, clamped to the cart — so the
 * two can never drift into disagreeing about what a customer is owed.
 */

const fixed = (amountUgx: number | null) => ({
  benefitKind: "fixed_discount" as const,
  benefitAmountUgx: amountUgx,
  benefitPercent: null,
});

const percent = (pct: number | null) => ({
  benefitKind: "percentage_discount" as const,
  benefitAmountUgx: null,
  benefitPercent: pct,
});

describe("fixed UGX benefits", () => {
  it("previews the reward's amount against the cart", () => {
    expect(previewBenefitAmountUgx(fixed(5_000), 20_000)).toBe(5_000);
  });

  it("clamps to the cart so the total can never go negative", () => {
    // The brief's own case: a 5,000 reward on a 3,000 cart discounts 3,000, not 5,000.
    expect(previewBenefitAmountUgx(fixed(5_000), 3_000)).toBe(3_000);
    // …and exactly-enough leaves a zero total, never a negative one.
    expect(previewBenefitAmountUgx(fixed(3_000), 3_000)).toBe(3_000);
  });

  it("refuses to invent a benefit from a missing or invalid amount", () => {
    expect(previewBenefitAmountUgx(fixed(null), 20_000)).toBe(0);
    expect(previewBenefitAmountUgx(fixed(0), 20_000)).toBe(0);
    expect(previewBenefitAmountUgx(fixed(-500), 20_000)).toBe(0);
  });
});

describe("percentage benefits", () => {
  it("previews a floored percentage of the cart", () => {
    expect(previewBenefitAmountUgx(percent(10), 20_000)).toBe(2_000);
    // Floored, exactly as the server does: 10% of 33,333 is 3,333.3 → 3,333.
    expect(previewBenefitAmountUgx(percent(10), 33_333)).toBe(3_333);
  });

  it("still cannot exceed the cart", () => {
    expect(previewBenefitAmountUgx(percent(100), 7_500)).toBe(7_500);
  });

  it("refuses a percentage the database could not hold anyway", () => {
    for (const bad of [0, -10, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(previewBenefitAmountUgx(percent(bad), 20_000), String(bad)).toBe(0);
    }
  });
});

describe("nothing else produces a discount", () => {
  it("an empty cart has nothing to discount", () => {
    expect(previewBenefitAmountUgx(fixed(5_000), 0)).toBe(0);
    expect(previewBenefitAmountUgx(percent(10), 0)).toBe(0);
  });

  it("a reward with no monetary benefit previews nothing", () => {
    expect(previewBenefitAmountUgx({ benefitKind: "none", benefitAmountUgx: null, benefitPercent: null }, 20_000)).toBe(0);
    expect(isMonetaryReward({ benefitKind: "none" })).toBe(false);
    expect(isMonetaryReward({ benefitKind: "fixed_discount" })).toBe(true);
    expect(isMonetaryReward({ benefitKind: "percentage_discount" })).toBe(true);
  });

  it("rounds a tiny percentage to nothing rather than to a free sale", () => {
    // 1% of 50 UGX floors to 0 — no discount is applied at all, rather than a 1-shilling one.
    expect(previewBenefitAmountUgx(percent(1), 50)).toBe(0);
  });
});

describe("how the benefit reads to a cashier", () => {
  it("labels a fixed benefit in UGX and a percentage as a percentage", () => {
    expect(benefitLabel(fixed(5_000))).toBe("UGX 5,000 off");
    expect(benefitLabel(percent(10))).toBe("10% off");
  });

  it("has no label when there is no benefit", () => {
    expect(benefitLabel({ benefitKind: "none", benefitAmountUgx: null, benefitPercent: null })).toBeNull();
    expect(benefitLabel(fixed(null))).toBeNull();
  });
});
