import { describe, expect, it } from "vitest";
import type { BusinessType } from "../types";
import { ONBOARDING_BUSINESS_CARDS } from "./onboardingFlow";
import {
  DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS,
  filterOnboardingBusinessCards,
  getVisibleBusinessTypes,
  isBusinessTypeVisibleForOnboarding,
  type PlatformBusinessTypeSettings,
} from "./businessTypeVisibility";

describe("businessTypeVisibility", () => {
  it("shows all types for normal users when defaults are fully enabled", () => {
    const visible = getVisibleBusinessTypes(DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS, false);
    expect(visible.length).toBe(15);
    const cards = filterOnboardingBusinessCards(ONBOARDING_BUSINESS_CARDS, DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS, false);
    expect(cards.length).toBe(ONBOARDING_BUSINESS_CARDS.length);
  });

  it("hides disabled types from normal users", () => {
    const settings = {
      enabled: ["kiosk_duka", "pharmacy"] as BusinessType[],
      showExperimental: false,
    };
    expect(isBusinessTypeVisibleForOnboarding("hardware", settings, false)).toBe(false);
    expect(isBusinessTypeVisibleForOnboarding("pharmacy", settings, false)).toBe(true);
    const cards = filterOnboardingBusinessCards(ONBOARDING_BUSINESS_CARDS, settings, false);
    expect(cards.some((c) => c.businessType === "hardware")).toBe(false);
    expect(cards.some((c) => c.businessType === "pharmacy")).toBe(true);
  });

  it("lets super admin see disabled types", () => {
    const settings = {
      enabled: ["kiosk_duka"] as BusinessType[],
      showExperimental: false,
    };
    const visible = getVisibleBusinessTypes(settings, true);
    expect(visible.some((v) => v.id === "boutique" && v.status === "disabled")).toBe(true);
  });

  it("shows experimental types to super admin even when experimental section flag is off", () => {
    const settings: PlatformBusinessTypeSettings = {
      enabled: ["kiosk_duka"],
      showExperimental: false,
    };
    const visible = getVisibleBusinessTypes(settings, true);
    expect(visible.some((v) => v.id === "salon" && v.status === "experimental")).toBe(true);
  });
});
