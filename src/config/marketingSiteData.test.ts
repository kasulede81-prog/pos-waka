import { describe, expect, it } from "vitest";
import { assertMarketingPricingIntegrity, MARKETING_HARDWARE_PACKAGES, MARKETING_PLANS } from "./marketingSiteData";

describe("marketingSiteData", () => {
  it("keeps marketing plan prices aligned with canonical subscription pricing", () => {
    expect(() => assertMarketingPricingIntegrity()).not.toThrow();
  });

  it("uses brochure hardware prices", () => {
    expect(MARKETING_HARDWARE_PACKAGES[0]?.priceUgx).toBe(780_000);
    expect(MARKETING_HARDWARE_PACKAGES[1]?.priceUgx).toBe(480_000);
    expect(MARKETING_HARDWARE_PACKAGES[2]?.priceUgx).toBe(180_000);
  });

  it("highlights Business as most popular", () => {
    const popular = MARKETING_PLANS.filter((p) => p.popular);
    expect(popular).toHaveLength(1);
    expect(popular[0]?.code).toBe("business");
  });

  it("does not mention AI assistant in public plan features", () => {
    for (const plan of MARKETING_PLANS) {
      for (const feature of plan.features) {
        expect(feature.toLowerCase()).not.toMatch(/\bai\b/);
      }
    }
  });
});
