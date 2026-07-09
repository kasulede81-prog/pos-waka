import { describe, expect, it } from "vitest";
import { actorHasPermission, actorHasEffectivePermission } from "../actorAuthorization";
import { checkStorePermission, checkStorePermissionEffective } from "../storeAuthorization";
import { resolveStaffPermissions } from "./resolvePermissions";
import { hasBackOfficeShellAccess } from "../backOfficeAccess";
import type { SessionActor } from "../sessionActor";
import type { CustomStaffRole, StaffAccount } from "../../types";
import type { SubscriptionSnapshot } from "../subscriptionEntitlements";

const LOCAL_SNAPSHOT: SubscriptionSnapshot = { kind: "local_full" };
const STAMP = "2026-01-01T00:00:00.000Z";

function customRole(overrides: Partial<CustomStaffRole> & Pick<CustomStaffRole, "id" | "name" | "permissions">): CustomStaffRole {
  return {
    status: "active",
    inheritsFrom: "cashier",
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function staffWithCustomRole(custom: CustomStaffRole): { staff: StaffAccount; actor: SessionActor } {
  const staff: StaffAccount = {
    id: "staff-1",
    name: "Custom Tester",
    role: "cashier",
    active: true,
    customRoleId: custom.id,
    pin: "",
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  const permissions = resolveStaffPermissions(staff, [custom]);
  return {
    staff,
    actor: {
      userId: `staff:${staff.id}`,
      role: staff.role,
      displayName: staff.name,
      permissions,
      customRoleId: custom.id,
    },
  };
}

describe("Enterprise Permission Certification (Phase 13.4)", () => {
  it("custom role snapshot overrides built-in cashier matrix", () => {
    const reportsOnly = customRole({
      id: "cr-reports",
      name: "Reports Clerk",
      permissions: ["reports.view", "back_office.access"],
    });
    const { actor } = staffWithCustomRole(reportsOnly);

    expect(actorHasPermission(actor, "reports.view")).toBe(true);
    expect(actorHasPermission(actor, "back_office.access")).toBe(true);
    expect(actorHasPermission(actor, "pos.sell")).toBe(false);
    expect(actorHasPermission(actor, "settings.shop")).toBe(false);
  });

  it("disabled custom role falls back to staff role matrix", () => {
    const disabled = customRole({
      id: "cr-off",
      name: "Disabled",
      status: "disabled",
      permissions: ["settings.shop"],
    });
    const staff: StaffAccount = {
      id: "s2",
      name: "Cashier",
      role: "cashier",
      active: true,
      customRoleId: disabled.id,
      pin: "",
      createdAt: STAMP,
      updatedAt: STAMP,
    };
    const perms = resolveStaffPermissions(staff, [disabled]);
    expect(perms.includes("settings.shop")).toBe(false);
    expect(perms.includes("pos.sell")).toBe(true);
  });

  it("store layer honors actor permission snapshot", () => {
    const stockCustom = customRole({
      id: "cr-stock",
      name: "Stock Only",
      permissions: ["stock.view", "stock.adjust", "back_office.access"],
    });
    const { actor } = staffWithCustomRole(stockCustom);

    expect(checkStorePermission(actor, "stock.adjust").ok).toBe(true);
    expect(checkStorePermission(actor, "settings.shop").ok).toBe(false);
    expect(checkStorePermissionEffective(actor, "stock.adjust", LOCAL_SNAPSHOT, "local").ok).toBe(true);
  });

  it("route shell access uses actor permissions not role label alone", () => {
    const debtClerk = customRole({
      id: "cr-debt",
      name: "Debt Clerk",
      permissions: ["customers.view", "customers.debt"],
    });
    const { actor } = staffWithCustomRole(debtClerk);

    expect(
      hasBackOfficeShellAccess({
        pathname: "/debts",
        role: actor.role,
        snapshot: LOCAL_SNAPSHOT,
        authMode: "local",
        actorPermissions: actor.permissions,
      }),
    ).toBe(true);

    expect(
      hasBackOfficeShellAccess({
        pathname: "/reports",
        role: actor.role,
        snapshot: LOCAL_SNAPSHOT,
        authMode: "local",
        actorPermissions: actor.permissions,
      }),
    ).toBe(false);
  });

  it("tier gating still applies with custom permissions", () => {
    const ownerLike = customRole({
      id: "cr-owner",
      name: "Owner Clone",
      permissions: ["owner.dashboard", "reports.profit", "settings.shop"],
    });
    const { actor } = staffWithCustomRole(ownerLike);

    expect(actorHasEffectivePermission(actor, "reports.profit", LOCAL_SNAPSHOT, "local")).toBe(true);
    expect(
      actorHasEffectivePermission(actor, "reports.profit", { kind: "none" }, "supabase"),
    ).toBe(false);
  });
});
