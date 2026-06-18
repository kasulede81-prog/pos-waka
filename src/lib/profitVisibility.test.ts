import { describe, expect, it } from "vitest";
import { resolveProfitVisibility } from "./profitVisibility";
import type { RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";

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

describe("resolveProfitVisibility", () => {
  it("owner on starter tier can see profit", () => {
    const v = resolveProfitVisibility({
      role: "owner",
      snapshot: remote({ plan_code: "starter", status: "active" }),
      authMode: "supabase",
    });
    expect(v.canProfit).toBe(true);
    expect(v.canShopWideFinancials).toBe(true);
    expect(v.canFinanceDiagnostics).toBe(true);
  });

  it("manager can see profit but not finance diagnostics", () => {
    const v = resolveProfitVisibility({
      role: "manager",
      snapshot: remote({ plan_code: "business", status: "active" }),
      authMode: "supabase",
    });
    expect(v.canProfit).toBe(true);
    expect(v.canShopWideFinancials).toBe(true);
    expect(v.canFinanceDiagnostics).toBe(false);
  });

  it("cashier never sees profit even on paid tier", () => {
    const v = resolveProfitVisibility({
      role: "cashier",
      snapshot: remote({ plan_code: "waka_plus", status: "active" }),
      authMode: "supabase",
    });
    expect(v.canProfit).toBe(false);
    expect(v.canShopWideFinancials).toBe(false);
  });

  it("owner on free tier cannot see profit", () => {
    const v = resolveProfitVisibility({
      role: "owner",
      snapshot: remote({ plan_code: "free", status: "active" }),
      authMode: "supabase",
    });
    expect(v.canProfit).toBe(false);
  });

  it("local owner resolves profit via role matrix", () => {
    const v = resolveProfitVisibility({
      role: "owner",
      snapshot: { kind: "local_full" },
      authMode: "local",
    });
    expect(v.canProfit).toBe(true);
  });
});
