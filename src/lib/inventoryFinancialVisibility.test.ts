import { describe, expect, it } from "vitest";
import { resolveSessionActor, type SessionActor } from "./sessionActor";
import type { UserRole } from "../types";
import type { RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";
import { actorCanSeeInventoryCostValue } from "./inventoryFinancialVisibility";
import { actorHasPermission } from "./actorAuthorization";

const STARTER: SubscriptionSnapshot = {
  kind: "remote",
  row: {
    id: "1",
    organization_id: "o1",
    shop_id: "s1",
    plan_code: "starter",
    status: "active",
    trial_ends_at: null,
    current_period_start: null,
    current_period_end: null,
    max_pos_users: null,
    max_shops: null,
    max_devices: null,
  } as RemoteSubscriptionRow,
};

const FREE: SubscriptionSnapshot = {
  kind: "remote",
  row: {
    ...STARTER.row,
    plan_code: "free",
  } as RemoteSubscriptionRow,
};

function actor(role: UserRole): SessionActor {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: `${role}@waka.invalid` } as never,
    email: `${role}@waka.invalid`,
    shopMemberRole: role,
    preferences: {} as never,
  });
}

describe("actorCanSeeInventoryCostValue", () => {
  it("hides cost/value from cashier (no reports.profit, no stock.adjust)", () => {
    const cashier = actor("cashier");
    expect(actorHasPermission(cashier, "reports.profit")).toBe(false);
    expect(actorHasPermission(cashier, "stock.adjust")).toBe(false);
    expect(actorCanSeeInventoryCostValue(cashier, STARTER, "supabase")).toBe(false);
  });

  it("keeps owner, manager, and stock keeper visible on a paid shop", () => {
    expect(actorCanSeeInventoryCostValue(actor("owner"), STARTER, "supabase")).toBe(true);
    expect(actorCanSeeInventoryCostValue(actor("manager"), STARTER, "supabase")).toBe(true);
    expect(actorCanSeeInventoryCostValue(actor("stock_keeper"), STARTER, "supabase")).toBe(true);
  });

  it("keeps stock keeper visible without reports.profit (stock.adjust)", () => {
    const keeper = actor("stock_keeper");
    expect(actorHasPermission(keeper, "reports.profit")).toBe(false);
    expect(actorHasPermission(keeper, "stock.adjust")).toBe(true);
    expect(actorCanSeeInventoryCostValue(keeper, FREE, "supabase")).toBe(true);
  });

  it("keeps owner visible on free tier via stock.adjust", () => {
    const owner = actor("owner");
    expect(actorHasPermission(owner, "stock.adjust")).toBe(true);
    expect(actorCanSeeInventoryCostValue(owner, FREE, "supabase")).toBe(true);
  });
});
