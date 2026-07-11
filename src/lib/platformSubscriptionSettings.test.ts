import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS,
  parsePlatformSubscriptionSettings,
  resolveGrantDurationDays,
} from "./platformSubscriptionSettings";

describe("platformSubscriptionSettings", () => {
  it("parses defaults matching current business rules", () => {
    const s = parsePlatformSubscriptionSettings(null);
    expect(s.defaultTrialDurationDays).toBe(14);
    expect(s.monthlyDurationDays).toBe(30);
    expect(s.yearlyDurationDays).toBe(365);
    expect(s.gracePeriodDays).toBe(0);
    expect(s.defaultTrialPlan).toBe("business");
  });

  it("clamps invalid values", () => {
    const s = parsePlatformSubscriptionSettings({
      defaultTrialDurationDays: 0,
      gracePeriodDays: 200,
      subscriptionReminderDays: [7, "x", 3],
    });
    expect(s.defaultTrialDurationDays).toBe(1);
    expect(s.gracePeriodDays).toBe(90);
    expect(s.subscriptionReminderDays).toEqual([7, 3]);
  });

  it("resolveGrantDurationDays respects billing cycle", () => {
    const settings = DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS;
    expect(resolveGrantDurationDays(settings, "monthly")).toBe(30);
    expect(resolveGrantDurationDays(settings, "yearly")).toBe(365);
    expect(resolveGrantDurationDays(settings, "trial")).toBe(14);
    expect(resolveGrantDurationDays(settings, null, 45)).toBe(45);
  });
});
