import { describe, expect, it } from "vitest";
import { resolveEffectiveSubscription } from "./effectiveSubscription";
import { evaluateExpiryCandidates } from "./subscriptionAutomation";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";

/**
 * M3-G — lifecycle lapse (pure unit).
 *
 * cancelled / paused / past_due subscriptions must never keep indefinite
 * paid entitlement, and past_due must be expirable (not a dead-end).
 */

const NOW = Date.parse("2026-10-07T12:00:00+00:00");
const PAST = "2026-10-01T12:00:00+00:00";
const FUTURE = "2026-12-01T12:00:00+00:00";

function snapshot(status: string, currentPeriodEnd: string | null): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: "sub-1",
      organization_id: "org-1",
      shop_id: "shop-1",
      status,
      trial_ends_at: null,
      current_period_start: "2026-09-01T12:00:00+00:00",
      current_period_end: currentPeriodEnd,
      plan_code: "business",
      max_pos_users: null,
      max_shops: null,
      max_devices: null,
    },
    promotionalGrant: null,
  };
}

describe("M3-G resolver lapse (cancelled / paused / past_due)", () => {
  it("1. cancelled with a past period end → free / expired", () => {
    const e = resolveEffectiveSubscription(snapshot("cancelled", PAST), NOW);
    expect(e.isExpired).toBe(true);
    expect(e.effectivePlan).toBe("free");
  });

  it("2. cancelled with paid time remaining still honours the period (no early cut)", () => {
    const e = resolveEffectiveSubscription(snapshot("cancelled", FUTURE), NOW);
    expect(e.isExpired).toBe(false);
    expect(e.effectivePlan).toBe("business");
  });

  it("3. paused with a past period end → free / expired", () => {
    const e = resolveEffectiveSubscription(snapshot("paused", PAST), NOW);
    expect(e.isExpired).toBe(true);
    expect(e.effectivePlan).toBe("free");
  });

  it("4. past_due with a past period end → free / expired (never indefinite)", () => {
    const e = resolveEffectiveSubscription(snapshot("past_due", PAST), NOW);
    expect(e.isExpired).toBe(true);
    expect(e.effectivePlan).toBe("free");
  });

  it("5. active with a past period end still expires (pre-existing rule unchanged)", () => {
    const e = resolveEffectiveSubscription(snapshot("active", PAST), NOW);
    expect(e.isExpired).toBe(true);
    expect(e.effectivePlan).toBe("free");
  });
});

describe("M3-G expiry evaluator (past_due is not a dead-end)", () => {
  const candidate = {
    subscriptionId: "sub-1",
    shopId: "shop-1",
    organizationId: "org-1",
    status: "past_due",
    trialEndsAt: null,
    periodEndAt: PAST,
  };

  it("6. past_due past its grace window becomes an expiry candidate", () => {
    const out = evaluateExpiryCandidates([candidate], NOW, 0);
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe("period_ended");
    expect(out[0]!.effectiveBefore.isExpired).toBe(true);
  });

  it("7. past_due still inside a 30-day grace window is NOT expired by the evaluator", () => {
    const out = evaluateExpiryCandidates([candidate], NOW, 30);
    expect(out).toHaveLength(0);
  });

  it("8. active past period end remains an expiry candidate (regression)", () => {
    const out = evaluateExpiryCandidates([{ ...candidate, status: "active" }], NOW, 0);
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe("period_ended");
  });

  it("9. cancelled rows are converged by the SERVER tick, not the client evaluator", () => {
    const out = evaluateExpiryCandidates([{ ...candidate, status: "cancelled" }], NOW, 0);
    expect(out).toHaveLength(0);
  });
});
