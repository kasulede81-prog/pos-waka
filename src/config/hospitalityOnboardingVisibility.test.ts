import { describe, expect, it } from "vitest";
import { filterHospitalityOnboardingStyles, parsePlatformBusinessTypeSettings } from "./businessTypeVisibility";

/** Real production `business_types_enabled` list observed before migration 20260918160000. */
const PROD_BEFORE = ["kiosk_duka", "boutique", "pharmacy", "wholesale", "restaurant", "mobile_money_agent", "other", "bar", "restaurant_bar"];

function styleIds(enabled: string[]): string[] {
  const settings = parsePlatformBusinessTypeSettings({ enabled, show_experimental: false });
  return filterHospitalityOnboardingStyles(settings, false).map((s) => s.id);
}

describe("hospitality onboarding visibility for merchants (non-super-admin)", () => {
  it("documents the bug: without 'hospitality' in the enabled list only Hotel is offered", () => {
    expect(styleIds(PROD_BEFORE)).toEqual([]);
  });

  it("after the migration Restaurant, Café, Bar and Restaurant + Bar are all offered", () => {
    expect(styleIds([...PROD_BEFORE, "hospitality"])).toEqual(["restaurant", "cafe", "bar", "restaurant_bar"]);
  });

  it("hotel still follows its own enabled flag", () => {
    expect(styleIds([...PROD_BEFORE, "hospitality", "hotel"])).toContain("hotel");
  });
});
