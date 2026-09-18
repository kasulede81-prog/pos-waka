import { describe, expect, it } from "vitest";
import {
  HOSPITALITY_ONBOARDING_GROUP_ID,
  HOSPITALITY_ONBOARDING_STYLES,
  businessTypeForHospitalityStyle,
  hospitalityStyleForStyleId,
  hospitalityStyleIdForBusinessType,
  isHospitalityOnboardingGroupCard,
} from "./hospitalityOnboarding";
import { ONBOARDING_BUSINESS_CARDS } from "./onboardingFlow";

describe("hospitality onboarding", () => {
  it("shows exactly one Hospitality option on shop onboarding", () => {
    const hospitalityCards = ONBOARDING_BUSINESS_CARDS.filter((c) => c.hospitalityGroup);
    expect(hospitalityCards).toHaveLength(1);
    expect(hospitalityCards[0]?.id).toBe(HOSPITALITY_ONBOARDING_GROUP_ID);
    // Restaurant / Bar / Restaurant + Bar are NOT separate top-level options.
    for (const legacy of ["restaurant", "bar", "restaurant_bar"]) {
      expect(ONBOARDING_BUSINESS_CARDS.some((c) => c.businessType === legacy)).toBe(false);
    }
  });

  it("maps every operating configuration to the ONE Hospitality business type", () => {
    expect(businessTypeForHospitalityStyle("restaurant")).toBe("hospitality");
    expect(businessTypeForHospitalityStyle("cafe")).toBe("hospitality");
    expect(businessTypeForHospitalityStyle("bar")).toBe("hospitality");
    expect(businessTypeForHospitalityStyle("restaurant_bar")).toBe("hospitality");
    // Hotel remains its own business type (untouched by the consolidation).
    expect(businessTypeForHospitalityStyle("hotel")).toBe("hotel");
  });

  it("stores the operating configuration per style id", () => {
    expect(hospitalityStyleForStyleId("restaurant")).toBe("restaurant");
    expect(hospitalityStyleForStyleId("cafe")).toBe("restaurant");
    expect(hospitalityStyleForStyleId("bar")).toBe("bar");
    expect(hospitalityStyleForStyleId("restaurant_bar")).toBe("restaurant_bar");
    expect(hospitalityStyleForStyleId("hotel")).toBeNull();
  });

  it("resolves style ids for new and legacy hospitality shops", () => {
    // New unified type uses the stored operating configuration.
    expect(hospitalityStyleIdForBusinessType("hospitality", "bar")).toBe("bar");
    expect(hospitalityStyleIdForBusinessType("hospitality", "restaurant_bar")).toBe("restaurant_bar");
    expect(hospitalityStyleIdForBusinessType("hospitality", "restaurant")).toBe("restaurant");
    expect(hospitalityStyleIdForBusinessType("hospitality", null)).toBe("restaurant");
    // Legacy business types derive their style (café was stored as restaurant).
    expect(hospitalityStyleIdForBusinessType("restaurant")).toBe("restaurant");
    expect(hospitalityStyleIdForBusinessType("bar")).toBe("bar");
    expect(hospitalityStyleIdForBusinessType("restaurant_bar")).toBe("restaurant_bar");
    expect(hospitalityStyleIdForBusinessType("kiosk_duka")).toBeNull();
  });

  it("offers the three operating configurations plus hotel", () => {
    expect(HOSPITALITY_ONBOARDING_STYLES.map((s) => s.id)).toEqual([
      "restaurant",
      "cafe",
      "bar",
      "restaurant_bar",
      "hotel",
    ]);
    // Every configuration except hotel stores businessType "hospitality".
    for (const s of HOSPITALITY_ONBOARDING_STYLES) {
      if (s.id === "hotel") {
        expect(s.businessType).toBe("hotel");
        expect(s.style).toBeUndefined();
      } else {
        expect(s.businessType).toBe("hospitality");
        expect(s.style).toBeTruthy();
      }
    }
  });

  it("detects hospitality group card id", () => {
    expect(isHospitalityOnboardingGroupCard(HOSPITALITY_ONBOARDING_GROUP_ID)).toBe(true);
    expect(isHospitalityOnboardingGroupCard("retail")).toBe(false);
  });
});
