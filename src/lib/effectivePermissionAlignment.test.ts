import { describe, expect, it } from "vitest";
import { hasBackOfficeShellAccess } from "./backOfficeAccess";
import { hasPermission } from "./permissions";
import { hasEffectivePermission, type RemoteSubscriptionRow, type SubscriptionSnapshot } from "./subscriptionEntitlements";
import { resolveProfitVisibility } from "./profitVisibility";

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

describe("effective permission alignment", () => {
  it("hasPermission alone over-grants reports.profit on free tier", () => {
    const snap = remote({ plan_code: "free", status: "active" });
    expect(hasPermission("owner", "reports.profit")).toBe(true);
    expect(hasEffectivePermission("owner", "reports.profit", snap, "supabase")).toBe(false);
  });

  it("resolveProfitVisibility matches effective permission for profit", () => {
    const snap = remote({ plan_code: "starter", status: "active" });
    const v = resolveProfitVisibility({ role: "owner", snapshot: snap, authMode: "supabase" });
    expect(v.canProfit).toBe(hasEffectivePermission("owner", "reports.profit", snap, "supabase"));
  });

  it("back office shell uses effective permission for stock keeper paths", () => {
    const snap = remote({ plan_code: "free", status: "active" });
    expect(
      hasBackOfficeShellAccess({
        pathname: "/stock",
        role: "stock_keeper",
        snapshot: snap,
        authMode: "supabase",
      }),
    ).toBe(hasEffectivePermission("stock_keeper", "stock.view", snap, "supabase"));
  });

  it("cashier denied back office shell on office hub", () => {
    const snap = remote({ plan_code: "business", status: "active" });
    expect(
      hasBackOfficeShellAccess({
        pathname: "/office/reports",
        role: "cashier",
        snapshot: snap,
        authMode: "supabase",
      }),
    ).toBe(false);
  });
});
