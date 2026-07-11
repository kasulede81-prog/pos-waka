import { describe, expect, it } from "vitest";
import {
  resolveActivePromotionalGrantTier,
  resolveEffectiveDeviceLimit,
  resolveEffectiveSubscription,
} from "./effectiveSubscription";
import type { PromotionalGrantRow, RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

function remote(
  row: Partial<RemoteSubscriptionRow> & Pick<RemoteSubscriptionRow, "plan_code" | "status">,
  grant?: PromotionalGrantRow | null,
): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: "1",
      organization_id: "o1",
      shop_id: "s1",
      trial_ends_at: null,
      current_period_start: null,
      current_period_end: null,
      max_pos_users: null,
      max_shops: null,
      max_devices: null,
      ...row,
    } as RemoteSubscriptionRow,
    promotionalGrant: grant ?? null,
  };
}

function iso(daysFromNow: number): string {
  return new Date(NOW + daysFromNow * 86400000).toISOString();
}

describe("resolveEffectiveSubscription", () => {
  it("grants business tier during active business trial", () => {
    const snap = remote({ plan_code: "business", status: "trial", trial_ends_at: iso(23) });
    const effective = resolveEffectiveSubscription(snap, NOW);
    expect(effective.effectivePlan).toBe("business");
    expect(effective.isTrial).toBe(true);
    expect(effective.isExpired).toBe(false);
    expect(effective.daysRemaining).toBe(23);
  });

  it("downgrades expired trial to free", () => {
    const snap = remote({ plan_code: "business", status: "trial", trial_ends_at: iso(-1) });
    const effective = resolveEffectiveSubscription(snap, NOW);
    expect(effective.effectivePlan).toBe("free");
    expect(effective.isTrial).toBe(false);
    expect(effective.isExpired).toBe(true);
    expect(effective.status).toBe("expired");
  });

  it("applies promotional grant overlay on free subscription", () => {
    const snap = remote(
      { plan_code: "free", status: "active" },
      {
        id: "g1",
        plan_code: "business",
        granted_by: "manual_admin",
        campaign_id: null,
        granted_at: iso(-5),
        expires_at: iso(30),
        revoked_at: null,
      },
    );
    const effective = resolveEffectiveSubscription(snap, NOW);
    expect(effective.effectivePlan).toBe("business");
    expect(effective.source).toBe("promotional_grant");
    expect(effective.subscriptionType).toBe("promotional");
  });

  it("never downgrades paid tier during lower promotional grant", () => {
    const snap = remote(
      { plan_code: "waka_plus", status: "active", current_period_end: iso(20) },
      {
        id: "g1",
        plan_code: "starter",
        granted_by: "growth_campaign",
        campaign_id: "c1",
        granted_at: iso(-1),
        expires_at: iso(100),
        revoked_at: null,
      },
    );
    expect(resolveEffectiveSubscription(snap, NOW).effectivePlan).toBe("waka_plus");
  });

  it("expires active paid subscription past current_period_end", () => {
    const snap = remote({
      plan_code: "starter",
      status: "active",
      current_period_end: iso(-2),
    });
    expect(resolveEffectiveSubscription(snap, NOW).effectivePlan).toBe("free");
  });

  it("resolves device limit from effective tier when grant boosts plan", () => {
    const snap = remote(
      { plan_code: "free", status: "active", max_devices: 1 },
      {
        id: "g1",
        plan_code: "business",
        granted_by: "manual_admin",
        campaign_id: null,
        granted_at: iso(-1),
        expires_at: iso(30),
        revoked_at: null,
      },
    );
    expect(resolveEffectiveDeviceLimit(snap, "supabase", NOW)).toBe(4);
  });
});

describe("resolveActivePromotionalGrantTier", () => {
  it("returns null for revoked or expired grants", () => {
    const snap = remote(
      { plan_code: "free", status: "active" },
      {
        id: "g1",
        plan_code: "business",
        granted_by: "manual_admin",
        campaign_id: null,
        granted_at: iso(-10),
        expires_at: iso(-1),
        revoked_at: null,
      },
    );
    expect(resolveActivePromotionalGrantTier(snap, NOW)).toBeNull();
  });
});
