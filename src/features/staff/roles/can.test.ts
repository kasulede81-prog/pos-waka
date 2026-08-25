import { describe, expect, it } from "vitest";
import { actorHasPermission } from "../../../lib/actorAuthorization";
import { buildCustomRolePermissions, resolveStaffPermissions } from "../../../lib/enterpriseRoles";
import { permissionLabel } from "../../../lib/enterpriseRoles/permissionLabels";
import { resolveSessionActor, type SessionActor } from "../../../lib/sessionActor";
import { can, permissionForStaffAction, type StaffAction } from "./can";

const OWNER_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASHIER_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MANAGER_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function actorForMember(role: "owner" | "manager" | "cashier", userId: string): SessionActor {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: userId, email: `${role}@waka.invalid` } as never,
    email: `${role}@waka.invalid`,
    shopMemberRole: role,
    preferences: {} as never,
  });
}

function assertCanMatchesLegacy(actor: SessionActor, action: StaffAction) {
  const permission = permissionForStaffAction(action);
  expect(can(actor, action)).toBe(actorHasPermission(actor, permission));
}

describe("Staff Phase 3 can() permission gateway", () => {
  it("maps friendly actions onto existing Permission codes", () => {
    expect(permissionForStaffAction("sell")).toBe("pos.sell");
    expect(permissionForStaffAction("create_sale")).toBe("pos.sell");
    expect(permissionForStaffAction("refund_sale")).toBe("sale_void");
    expect(permissionForStaffAction("manage_staff")).toBe("settings.shop");
    expect(permissionForStaffAction("view_reports")).toBe("reports.view");
    expect(permissionForStaffAction("pos.sell")).toBe("pos.sell");
  });

  it("Owner — sell, manage staff, view reports (matches actorHasPermission)", () => {
    const owner = actorForMember("owner", OWNER_UUID);
    expect(can(owner, "sell")).toBe(true);
    expect(can(owner, "manage_staff")).toBe(true);
    expect(can(owner, "view_reports")).toBe(true);
    expect(can(owner, "view_profit")).toBe(true);
    for (const action of [
      "sell",
      "refund_sale",
      "manage_staff",
      "view_reports",
      "view_profit",
      "settings.shop",
      "pos.sell",
    ] as StaffAction[]) {
      assertCanMatchesLegacy(owner, action);
    }
  });

  it("Manager — can sell; staff/settings.shop depends on matrix (no settings.shop)", () => {
    const manager = actorForMember("manager", MANAGER_UUID);
    expect(can(manager, "sell")).toBe(true);
    expect(can(manager, "view_reports")).toBe(true);
    // Manager matrix has settings.view / receipt but not settings.shop (staff center).
    expect(can(manager, "manage_staff")).toBe(false);
    expect(actorHasPermission(manager, "settings.shop")).toBe(false);
    assertCanMatchesLegacy(manager, "sell");
    assertCanMatchesLegacy(manager, "manage_staff");
    assertCanMatchesLegacy(manager, "view_reports");
    assertCanMatchesLegacy(manager, "refund_sale");
  });

  it("Cashier — can sell; cannot manage staff", () => {
    const cashier = actorForMember("cashier", CASHIER_UUID);
    expect(can(cashier, "sell")).toBe(true);
    expect(can(cashier, "create_sale")).toBe(true);
    expect(can(cashier, "manage_staff")).toBe(false);
    expect(can(cashier, "view_reports")).toBe(false);
    assertCanMatchesLegacy(cashier, "sell");
    assertCanMatchesLegacy(cashier, "manage_staff");
    assertCanMatchesLegacy(cashier, "view_reports");
    assertCanMatchesLegacy(cashier, "refund_sale");
  });

  it("Custom role — follows resolveStaffPermissions snapshot (can === legacy)", () => {
    const customPerms = buildCustomRolePermissions("cashier", ["reports.view"], ["sale_void"]);
    const customActor: SessionActor = {
      ...actorForMember("cashier", CASHIER_UUID),
      authPermissions: customPerms,
      permissions: customPerms,
    };
    expect(resolveStaffPermissions({ role: "cashier", permissions: customPerms, customRoleId: null }, [])).toEqual(
      customPerms,
    );
    expect(can(customActor, "sell")).toBe(true);
    expect(can(customActor, "view_reports")).toBe(true);
    expect(can(customActor, "refund_sale")).toBe(false);
    expect(can(customActor, "manage_staff")).toBe(false);
    assertCanMatchesLegacy(customActor, "sell");
    assertCanMatchesLegacy(customActor, "view_reports");
    assertCanMatchesLegacy(customActor, "refund_sale");
    assertCanMatchesLegacy(customActor, "manage_staff");
  });

  it("null actor is denied (same as actorHasPermission)", () => {
    expect(can(null, "sell")).toBe(false);
    expect(actorHasPermission(null, "pos.sell")).toBe(false);
  });
});

describe("Staff Phase 5b business action dictionary", () => {
  it("maps dotted business actions onto existing Permission codes", () => {
    expect(permissionForStaffAction("sale.create")).toBe("pos.sell");
    expect(permissionForStaffAction("sale.void")).toBe("sale_void");
    expect(permissionForStaffAction("sale.refund")).toBe("sale_void");
    expect(permissionForStaffAction("sale.discount")).toBe("pos.sell");
    expect(permissionForStaffAction("sale.hold")).toBe("pending_sales.manage");
    expect(permissionForStaffAction("receipt.view")).toBe("receipts.view");
    expect(permissionForStaffAction("inventory.view")).toBe("stock.view");
    expect(permissionForStaffAction("inventory.adjust")).toBe("stock.adjust");
    expect(permissionForStaffAction("inventory.count")).toBe("stock.count");
    expect(permissionForStaffAction("product.add")).toBe("products.add");
    expect(permissionForStaffAction("product.edit")).toBe("products.edit_presets");
    expect(permissionForStaffAction("product.remove")).toBe("products.remove");
    expect(permissionForStaffAction("inventory.purchase")).toBe("purchases.record");
    expect(permissionForStaffAction("customer.view")).toBe("customers.view");
    expect(permissionForStaffAction("customer.credit")).toBe("customers.debt");
    expect(permissionForStaffAction("supplier.view")).toBe("suppliers.view");
    expect(permissionForStaffAction("supplier.manage")).toBe("suppliers.manage");
    expect(permissionForStaffAction("staff.view")).toBe("settings.shop");
    expect(permissionForStaffAction("staff.invite")).toBe("settings.shop");
    expect(permissionForStaffAction("staff.manage")).toBe("settings.shop");
    expect(permissionForStaffAction("shop.settings")).toBe("settings.shop");
    expect(permissionForStaffAction("shop.receipt_settings")).toBe("settings.receipt");
    expect(permissionForStaffAction("shop.devices")).toBe("settings.devices");
    expect(permissionForStaffAction("report.view")).toBe("reports.view");
    expect(permissionForStaffAction("report.profit")).toBe("reports.profit");
    expect(permissionForStaffAction("backoffice.enter")).toBe("back_office.access");
  });

  it("can(actor, sale.refund) equals existing sale_void behavior", () => {
    const owner = actorForMember("owner", OWNER_UUID);
    const cashier = actorForMember("cashier", CASHIER_UUID);
    expect(can(owner, "sale.refund")).toBe(actorHasPermission(owner, "sale_void"));
    expect(can(cashier, "sale.refund")).toBe(actorHasPermission(cashier, "sale_void"));
    expect(can(owner, "sale.refund")).toBe(can(owner, "refund_sale"));
    expect(can(owner, "sale.refund")).toBe(can(owner, "void_sale"));
  });

  it("can(actor, staff.manage) equals existing settings.shop behavior", () => {
    const owner = actorForMember("owner", OWNER_UUID);
    const manager = actorForMember("manager", MANAGER_UUID);
    const cashier = actorForMember("cashier", CASHIER_UUID);
    expect(can(owner, "staff.manage")).toBe(actorHasPermission(owner, "settings.shop"));
    expect(can(manager, "staff.manage")).toBe(actorHasPermission(manager, "settings.shop"));
    expect(can(cashier, "staff.manage")).toBe(actorHasPermission(cashier, "settings.shop"));
    expect(can(owner, "staff.manage")).toBe(can(owner, "manage_staff"));
    expect(can(owner, "staff.manage")).toBe(true);
    expect(can(manager, "staff.manage")).toBe(false);
  });

  it("legacy aliases still work beside dotted business actions", () => {
    const owner = actorForMember("owner", OWNER_UUID);
    expect(can(owner, "sell")).toBe(can(owner, "sale.create"));
    expect(can(owner, "create_sale")).toBe(can(owner, "sale.create"));
    expect(can(owner, "refund_sale")).toBe(can(owner, "sale.refund"));
    expect(can(owner, "void_sale")).toBe(can(owner, "sale.void"));
    expect(can(owner, "manage_staff")).toBe(can(owner, "staff.manage"));
  });

  it("Roles Center labels are owner-friendly (not raw Permission codes)", () => {
    expect(permissionLabel("en", "sale_void")).toBe("Void or refund sales");
    expect(permissionLabel("en", "settings.shop")).toBe("Manage staff and shop settings");
    expect(permissionLabel("en", "sale_void")).not.toBe("sale_void");
    expect(permissionLabel("en", "settings.shop")).not.toBe("settings.shop");
  });
});
