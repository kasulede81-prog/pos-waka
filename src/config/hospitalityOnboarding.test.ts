import { describe, expect, it } from "vitest";
import {
  HOSPITALITY_ONBOARDING_GROUP_ID,
  HOSPITALITY_ONBOARDING_STYLES,
  businessTypeForHospitalityStyle,
  hospitalityStyleIdForBusinessType,
  isHospitalityOnboardingGroupCard,
} from "./hospitalityOnboarding";
import { ONBOARDING_BUSINESS_CARDS } from "./onboardingFlow";

describe("hospitality onboarding", () => {
  it("shows one hospitality group card on shop onboarding", () => {
    const hospitalityCards = ONBOARDING_BUSINESS_CARDS.filter((c) => c.hospitalityGroup);
    expect(hospitalityCards).toHaveLength(1);
    expect(hospitalityCards[0]?.id).toBe(HOSPITALITY_ONBOARDING_GROUP_ID);
    expect(ONBOARDING_BUSINESS_CARDS.some((c) => c.businessType === "bar")).toBe(false);
  });

  it("maps café style to restaurant business_type", () => {
    expect(businessTypeForHospitalityStyle("cafe")).toBe("restaurant");
    expect(businessTypeForHospitalityStyle("bar")).toBe("bar");
    expect(businessTypeForHospitalityStyle("hotel")).toBe("hotel");
  });

  it("resolves style ids for existing hospitality shops", () => {
    expect(hospitalityStyleIdForBusinessType("restaurant")).toBe("restaurant");
    expect(hospitalityStyleIdForBusinessType("bar")).toBe("bar");
    expect(hospitalityStyleIdForBusinessType("kiosk_duka")).toBeNull();
  });

  it("lists five subtype options", () => {
    expect(HOSPITALITY_ONBOARDING_STYLES.map((s) => s.id)).toEqual([
      "restaurant",
      "cafe",
      "bar",
      "restaurant_bar",
      "hotel",
    ]);
  });

  it("detects hospitality group card id", () => {
    expect(isHospitalityOnboardingGroupCard(HOSPITALITY_ONBOARDING_GROUP_ID)).toBe(true);
    expect(isHospitalityOnboardingGroupCard("retail")).toBe(false);
  });
});
