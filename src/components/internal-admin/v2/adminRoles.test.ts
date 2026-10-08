import { describe, expect, it } from "vitest";
import {
  adminPermissions,
  canManageGrowthCampaigns,
  canManageShopVision,
  canManageSubscriptionLifecycle,
  canManageTrials,
  canResetOwnerPassword,
  canCorrectFinancials,
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

describe("canCorrectFinancials", () => {
  it("allows only super_admin and finance_admin — never owner/manager/cashier-equivalent internal roles", () => {
    expect(canCorrectFinancials("super_admin")).toBe(true);
    expect(canCorrectFinancials("finance_admin")).toBe(true);
    expect(canCorrectFinancials("operations_admin")).toBe(false);
    expect(canCorrectFinancials("support_admin")).toBe(false);
    expect(canCorrectFinancials("field_agent")).toBe(false);
    expect(canCorrectFinancials("subscriptions_admin")).toBe(false);
  });
});

/**
 * SERVER-MIRRORING GATES (Phase 3).
 *
 * Four places offered controls the server refuses. In every case the fix was to
 * align the CLIENT to the server — never to loosen the server — so each test
 * below pins the exact role set the corresponding RPC/Edge Function accepts, and
 * that the narrow gate really is narrower than the broad one it replaced.
 *
 * A regression here does not open a hole (the server still refuses); it puts
 * working-looking buttons in front of an operator, which is its own defect.
 */
describe("subscription + shop gates mirror the server", () => {
  const ALL_ROLES = [
    "super_admin",
    "subscriptions_admin",
    "finance_admin",
    "operations_admin",
    "support_admin",
    "field_agent",
    "viewer",
    "",
  ];

  it("canManageSubscriptionLifecycle == super_admin | subscriptions_admin (028:491,633)", () => {
    expect(ALL_ROLES.filter(canManageSubscriptionLifecycle)).toEqual([
      "super_admin",
      "subscriptions_admin",
    ]);
    // The two roles the OLD gate wrongly included.
    expect(canManageSubscriptionLifecycle("finance_admin")).toBe(false);
    expect(canManageSubscriptionLifecycle("operations_admin")).toBe(false);
  });

  it("lifecycle is strictly narrower than the grant gate it used to share", () => {
    // Grant/renew stays on canManageTrials (admin_shop_set_subscription_plan
    // really does allow all four); the lifecycle actions do not.
    for (const role of ALL_ROLES) {
      if (canManageSubscriptionLifecycle(role)) expect(canManageTrials(role)).toBe(true);
    }
    expect(canManageTrials("operations_admin")).toBe(true);
    expect(canManageSubscriptionLifecycle("operations_admin")).toBe(false);
  });

  it("canManageShopVision == super_admin | operations_admin (145)", () => {
    expect(ALL_ROLES.filter(canManageShopVision)).toEqual(["super_admin", "operations_admin"]);
    expect(canManageShopVision("subscriptions_admin")).toBe(false);
    expect(canManageShopVision("finance_admin")).toBe(false);
  });

  it("canResetOwnerPassword == super_admin | support_admin (admin-set-owner-password:54)", () => {
    expect(ALL_ROLES.filter(canResetOwnerPassword)).toEqual(["super_admin", "support_admin"]);
    // The two roles the shop console wrongly exposed it to.
    expect(canResetOwnerPassword("finance_admin")).toBe(false);
    expect(canResetOwnerPassword("operations_admin")).toBe(false);
  });

  it("canManageGrowthCampaigns == the four roles _growth_require_admin accepts (097:132)", () => {
    expect(ALL_ROLES.filter(canManageGrowthCampaigns)).toEqual([
      "super_admin",
      "subscriptions_admin",
      "finance_admin",
      "operations_admin",
    ]);
    // Internal staff who are NOT in the list — the page had no gate at all before.
    expect(canManageGrowthCampaigns("support_admin")).toBe(false);
    expect(canManageGrowthCampaigns("field_agent")).toBe(false);
  });

  it("all four are exposed on adminPermissions", () => {
    const perms = adminPermissions({
      id: "1",
      email: "a@b.c",
      full_name: "Ops",
      role: "operations_admin",
      assigned_district_ids: [],
      active: true,
      max_shops: null,
    } as never);
    // operations_admin: may grant and run campaigns, may NOT change lifecycle,
    // may manage Vision, may NOT reset the owner password.
    expect(perms.canManageTrials).toBe(true);
    expect(perms.canManageGrowthCampaigns).toBe(true);
    expect(perms.canManageShopVision).toBe(true);
    expect(perms.canManageSubscriptionLifecycle).toBe(false);
    expect(perms.canResetOwnerPassword).toBe(false);
  });
});
