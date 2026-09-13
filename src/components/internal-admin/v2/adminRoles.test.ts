import { describe, expect, it } from "vitest";
import {
  adminPermissions,
  canManageAi,
  canManageShopAiSetup,
  canPermanentlyDeleteShopAccount,
  canRemoteSupport,
  canResetShopBusinessData,
} from "./adminRoles";

describe("canRemoteSupport", () => {
  it("allows support_admin and super_admin only", () => {
    expect(canRemoteSupport("support_admin")).toBe(true);
    expect(canRemoteSupport("super_admin")).toBe(true);
    expect(canRemoteSupport("operations_admin")).toBe(false);
    expect(canRemoteSupport("field_agent")).toBe(false);
    expect(canRemoteSupport("finance_admin")).toBe(false);
    expect(canRemoteSupport("subscriptions_admin")).toBe(false);
  });

  it("is exposed on adminPermissions and is not implied by ticket access", () => {
    const finance = adminPermissions({
      id: "1",
      email: "a@b.c",
      full_name: "Fin",
      role: "finance_admin",
      assigned_district_ids: [],
      active: true,
      max_shops: null,
    });
    expect(finance.canResolveSupport).toBe(true);
    expect(finance.canRemoteSupport).toBe(false);
    expect(finance.canManageAi).toBe(false);
  });
});

describe("canResetShopBusinessData", () => {
  it("allows super_admin and operations_admin only — broader than permanent delete, still not everyone", () => {
    expect(canResetShopBusinessData("super_admin")).toBe(true);
    expect(canResetShopBusinessData("operations_admin")).toBe(true);
    expect(canResetShopBusinessData("support_admin")).toBe(false);
    expect(canResetShopBusinessData("field_agent")).toBe(false);
    expect(canResetShopBusinessData("finance_admin")).toBe(false);
    expect(canResetShopBusinessData("subscriptions_admin")).toBe(false);
  });

  it("is strictly broader than canPermanentlyDeleteShopAccount, never narrower", () => {
    const roles = ["super_admin", "operations_admin", "support_admin", "field_agent", "finance_admin", "subscriptions_admin"];
    for (const role of roles) {
      if (canPermanentlyDeleteShopAccount(role)) {
        expect(canResetShopBusinessData(role)).toBe(true);
      }
    }
  });

  it("is exposed on adminPermissions", () => {
    const ops = adminPermissions({
      id: "1",
      email: "a@b.c",
      full_name: "Ops",
      role: "operations_admin",
      assigned_district_ids: [],
      active: true,
      max_shops: null,
    });
    expect(ops.canResetShopBusinessData).toBe(true);
    expect(ops.canPermanentlyDeleteShopAccount).toBe(false);

    const support = adminPermissions({
      id: "2",
      email: "b@c.d",
      full_name: "Support",
      role: "support_admin",
      assigned_district_ids: [],
      active: true,
      max_shops: null,
    });
    expect(support.canResetShopBusinessData).toBe(false);
  });
});

describe("canManageAi", () => {
  it("matches platform AI RPCs: super_admin and operations_admin", () => {
    expect(canManageAi("super_admin")).toBe(true);
    expect(canManageAi("operations_admin")).toBe(true);
    expect(canManageAi("support_admin")).toBe(false);
    expect(canManageAi("finance_admin")).toBe(false);
    expect(canManageAi("subscriptions_admin")).toBe(false);
    expect(canManageAi("field_agent")).toBe(false);
    expect(canManageShopAiSetup("support_admin")).toBe(true);
    expect(canManageShopAiSetup("finance_admin")).toBe(false);
  });
});
