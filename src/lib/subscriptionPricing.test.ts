import { describe, expect, it } from "vitest";
import {
  CANONICAL_PLAN_PRICES,
  MIN_FINAL_MONTHLY_UGX,
  buildDefaultPublicPricing,
  computePlanDisplayPrice,
  mapPublicPricingRpc,
} from "./subscriptionPricing";

describe("subscriptionPricing", () => {
  it("canonical prices match protected values", () => {
    expect(CANONICAL_PLAN_PRICES.find((p) => p.planCode === "starter")?.monthlyPriceUgx).toBe(18_000);
    expect(CANONICAL_PLAN_PRICES.find((p) => p.planCode === "business")?.monthlyPriceUgx).toBe(36_000);
    expect(CANONICAL_PLAN_PRICES.find((p) => p.planCode === "waka_plus")?.monthlyPriceUgx).toBe(82_000);
  });

  it("computes fixed monthly discount", () => {
    const result = computePlanDisplayPrice("business", {
      monthlyDiscountType: "fixed_amount",
      monthlyDiscountValue: 6_000,
    });
    expect(result.originalMonthlyUgx).toBe(36_000);
    expect(result.monthlyDiscountUgx).toBe(6_000);
    expect(result.finalMonthlyUgx).toBe(30_000);
    expect(result.hasMonthlyDiscount).toBe(true);
  });

  it("computes percentage monthly discount", () => {
    const result = computePlanDisplayPrice("starter", {
      monthlyDiscountType: "percentage",
      monthlyDiscountValue: 10,
    });
    expect(result.monthlyDiscountUgx).toBe(1_800);
    expect(result.finalMonthlyUgx).toBe(16_200);
  });

  it("applies annual discount to final monthly base", () => {
    const result = computePlanDisplayPrice("business", {
      monthlyDiscountType: "fixed_amount",
      monthlyDiscountValue: 6_000,
      annualDiscountPercent: 20,
    });
    expect(result.originalAnnualFullUgx).toBe(432_000);
    expect(result.finalAnnualUgx).toBe(288_000);
  });

  it("enforces minimum final monthly price", () => {
    const result = computePlanDisplayPrice("starter", {
      monthlyDiscountType: "fixed_amount",
      monthlyDiscountValue: 20_000,
    });
    expect(result.finalMonthlyUgx).toBe(MIN_FINAL_MONTHLY_UGX);
  });

  it("default public pricing has no campaign discounts", () => {
    const snap = buildDefaultPublicPricing();
    expect(snap.campaignActive).toBe(false);
    expect(snap.plans.every((p) => !p.hasMonthlyDiscount)).toBe(true);
    expect(snap.plans.find((p) => p.planCode === "starter")?.finalAnnualUgx).toBe(172_800);
  });

  it("maps RPC payload", () => {
    const snap = mapPublicPricingRpc({
      campaign_id: "abc",
      campaign_name: "Summer",
      campaign_active: true,
      plans: [
        {
          plan_code: "business",
          original_monthly_ugx: 36000,
          monthly_discount_ugx: 6000,
          final_monthly_ugx: 30000,
          original_annual_full_ugx: 432000,
          final_annual_ugx: 288000,
          annual_discount_percent: 20,
          has_monthly_discount: true,
          has_annual_discount: true,
        },
      ],
      as_of: "2026-06-01T00:00:00Z",
    });
    expect(snap.campaignActive).toBe(true);
    expect(snap.plans[0]?.finalMonthlyUgx).toBe(30_000);
  });
});
