import { describe, expect, it } from "vitest";
import {
  hasCommercialSubscription,
  hasEffectivePermission,
  resolveEffectivePlanTier,
  shouldShowFreeUpgradePitch,
  type RemoteSubscriptionRow,
  type SubscriptionSnapshot,
} from "./subscriptionEntitlements";

function remote(row: Partial<RemoteSubscriptionRow> & Pick<RemoteSubscriptionRow, "plan_code" | "status">): SubscriptionSnapshot {
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
  };
}

describe("shouldShowFreeUpgradePitch", () => {
  it("shows for free mode and missing subscription", () => {
    expect(shouldShowFreeUpgradePitch({ kind: "none" })).toBe(true);
    expect(shouldShowFreeUpgradePitch(remote({ plan_code: "free", status: "active" }))).toBe(true);
  });

  it("hides for active paid plans", () => {
    expect(shouldShowFreeUpgradePitch(remote({ plan_code: "business", status: "active" }))).toBe(false);
    expect(shouldShowFreeUpgradePitch(remote({ plan_code: "starter", status: "active" }))).toBe(false);
    expect(hasCommercialSubscription(remote({ plan_code: "waka_plus", status: "active" }))).toBe(true);
  });

  it("hides for trial on commercial plan (bootstrap business trial)", () => {
    expect(shouldShowFreeUpgradePitch(remote({ plan_code: "business", status: "trial" }))).toBe(false);
  });
});

describe("resolveEffectivePlanTier", () => {
  it("grants business tier during business trial", () => {
    const snap = remote({ plan_code: "business", status: "trial" });
    expect(resolveEffectivePlanTier(snap)).toBe("business");
  });

  it("grants starter tier during starter trialing", () => {
    const snap = remote({ plan_code: "starter", status: "trialing" });
    expect(resolveEffectivePlanTier(snap)).toBe("starter");
  });

  it("business trial unlocks owner dashboard for owner role", () => {
    const snap = remote({ plan_code: "business", status: "trial" });
    expect(hasEffectivePermission("owner", "owner.dashboard", snap, "supabase")).toBe(true);
    expect(hasEffectivePermission("owner", "settings.shop", snap, "supabase")).toBe(true);
    expect(hasEffectivePermission("owner", "reports.profit", snap, "supabase")).toBe(true);
  });
});
