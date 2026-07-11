import { describe, expect, it } from "vitest";
import {
  evaluateExpiryCandidates,
  evaluateGracePeriodCandidates,
  evaluateRenewalReminderCandidates,
} from "./subscriptionAutomation";
import { DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS } from "./platformSubscriptionSettings";
import { resolveEffectiveSubscription } from "./effectiveSubscription";

const MS_DAY = 86400000;
const now = Date.UTC(2026, 6, 10, 12, 0, 0);

describe("subscriptionAutomation", () => {
  it("finds expired trial candidates", () => {
    const trialEnd = new Date(now - MS_DAY).toISOString();
    const rows = [
      {
        subscriptionId: "sub-1",
        shopId: "shop-1",
        organizationId: "org-1",
        status: "trial",
        trialEndsAt: trialEnd,
        periodEndAt: null,
      },
    ];
    const candidates = evaluateExpiryCandidates(rows, now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.reason).toBe("trial_ended");
  });

  it("skips grace when gracePeriodDays is 0", () => {
    const periodEnd = new Date(now - MS_DAY).toISOString();
    const rows = [
      {
        subscriptionId: "sub-2",
        shopId: "shop-2",
        organizationId: "org-2",
        status: "active",
        trialEndsAt: null,
        periodEndAt: periodEnd,
      },
    ];
    expect(evaluateGracePeriodCandidates(rows, DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS, now)).toHaveLength(0);
  });

  it("finds grace candidates when grace period enabled", () => {
    const settings = { ...DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS, gracePeriodDays: 7 };
    const periodEnd = new Date(now - MS_DAY).toISOString();
    const rows = [
      {
        subscriptionId: "sub-3",
        shopId: "shop-3",
        organizationId: "org-3",
        status: "active",
        trialEndsAt: null,
        periodEndAt: periodEnd,
      },
    ];
    const candidates = evaluateGracePeriodCandidates(rows, settings, now);
    expect(candidates).toHaveLength(1);
  });

  it("finds renewal reminder candidates on matching days", () => {
    const periodEnd = new Date(now + 7 * MS_DAY).toISOString();
    const snap = {
      kind: "remote" as const,
      row: {
        id: "sub-4",
        organization_id: "org-4",
        shop_id: "shop-4",
        status: "active",
        trial_ends_at: null,
        current_period_start: new Date(now - 23 * MS_DAY).toISOString(),
        current_period_end: periodEnd,
        plan_code: "business",
        max_pos_users: null,
        max_shops: null,
        max_devices: null,
      },
      promotionalGrant: null,
    };
    const effective = resolveEffectiveSubscription(snap, now);
    expect(effective.daysRemaining).toBe(7);

    const rows = [
      {
        subscriptionId: "sub-4",
        shopId: "shop-4",
        organizationId: "org-4",
        status: "active",
        trialEndsAt: null,
        periodEndAt: periodEnd,
      },
    ];
    const reminders = evaluateRenewalReminderCandidates(rows, DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS, now);
    expect(reminders.some((r) => r.daysRemaining === 7)).toBe(true);
  });
});
