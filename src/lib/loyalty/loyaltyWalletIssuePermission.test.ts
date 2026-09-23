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

describe("loyalty.wallet_issue permission", () => {
  it("is granted to loyalty counter roles, not wait staff", () => {
    expect(hasPermission("owner", "loyalty.wallet_issue")).toBe(true);
    expect(hasPermission("manager", "loyalty.wallet_issue")).toBe(true);
    expect(hasPermission("supervisor", "loyalty.wallet_issue")).toBe(true);
    expect(hasPermission("cashier", "loyalty.wallet_issue")).toBe(true);
    expect(hasPermission("waiter", "loyalty.wallet_issue")).toBe(false);
    expect(hasPermission("kitchen", "loyalty.wallet_issue")).toBe(false);
  });

  it("is independent from settings.shop (cashiers can issue Wallet without shop settings)", () => {
    expect(hasPermission("cashier", "settings.shop")).toBe(false);
    expect(hasPermission("cashier", "loyalty.wallet_issue")).toBe(true);
    expect(hasPermission("manager", "settings.shop")).toBe(false);
    expect(hasPermission("manager", "loyalty.wallet_issue")).toBe(true);
  });

  it("session actor check matches role matrix for owners and cashiers", () => {
    expect(actorHasPermission(actor("owner"), "loyalty.wallet_issue")).toBe(true);
    expect(actorHasPermission(actor("cashier"), "loyalty.wallet_issue")).toBe(true);
    expect(actorHasPermission(actor("waiter"), "loyalty.wallet_issue")).toBe(false);
  });

  it("Path S style staff snapshot without loyalty.wallet_issue is denied", () => {
    expect(
      actorHasPermission(actor("cashier", ["pos.sell", "customers.view"]), "loyalty.wallet_issue"),
    ).toBe(false);
  });

  it("Path S style staff snapshot that includes loyalty.wallet_issue is allowed", () => {
    expect(
      actorHasPermission(
        actor("cashier", ["pos.sell", "customers.view", "loyalty.wallet_issue"]),
        "loyalty.wallet_issue",
      ),
    ).toBe(true);
  });
});
