import { describe, expect, it } from "vitest";
import { actorHasPermission } from "../actorAuthorization";
import { hasPermission } from "../permissions";
import type { SessionActor } from "../sessionActor";

function actor(role: SessionActor["role"], permissions?: SessionActor["permissions"]): SessionActor {
  return {
    userId: "user-1",
    role,
    authRole: role,
    authUserId: "user-1",
    permissions,
    authPermissions: permissions,
  };
}

describe("loyalty.redeem permission", () => {
  it("is granted to counter roles, not wait/kitchen/stock", () => {
    expect(hasPermission("owner", "loyalty.redeem")).toBe(true);
    expect(hasPermission("manager", "loyalty.redeem")).toBe(true);
    expect(hasPermission("supervisor", "loyalty.redeem")).toBe(true);
    expect(hasPermission("cashier", "loyalty.redeem")).toBe(true);
    expect(hasPermission("waiter", "loyalty.redeem")).toBe(false);
    expect(hasPermission("kitchen", "loyalty.redeem")).toBe(false);
    expect(hasPermission("bar", "loyalty.redeem")).toBe(false);
    expect(hasPermission("stock_keeper", "loyalty.redeem")).toBe(false);
  });

  it("is independent from settings.shop (cashiers redeem without shop settings)", () => {
    expect(hasPermission("cashier", "settings.shop")).toBe(false);
    expect(hasPermission("cashier", "loyalty.redeem")).toBe(true);
    expect(hasPermission("manager", "settings.shop")).toBe(false);
    expect(hasPermission("manager", "loyalty.redeem")).toBe(true);
  });

  it("session actor check matches role matrix", () => {
    expect(actorHasPermission(actor("owner"), "loyalty.redeem")).toBe(true);
    expect(actorHasPermission(actor("cashier"), "loyalty.redeem")).toBe(true);
    expect(actorHasPermission(actor("waiter"), "loyalty.redeem")).toBe(false);
  });

  it("Path S style staff snapshot without loyalty.redeem is denied", () => {
    expect(
      actorHasPermission(actor("cashier", ["pos.sell", "customers.view"]), "loyalty.redeem"),
    ).toBe(false);
  });

  it("Path S style staff snapshot that includes loyalty.redeem is allowed", () => {
    expect(
      actorHasPermission(
        actor("cashier", ["pos.sell", "customers.view", "loyalty.redeem"]),
        "loyalty.redeem",
      ),
    ).toBe(true);
  });
});
