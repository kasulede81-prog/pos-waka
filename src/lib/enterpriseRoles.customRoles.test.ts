import { describe, expect, it } from "vitest";
import {
  cloneCustomRoleFromTemplate,
  countStaffWithCustomRole,
  isCustomRoleAssignable,
  permissionCategoriesForBusiness,
  permissionsFromTemplate,
  summarizePermissionsByCategory,
} from "./enterpriseRoles";
import { resolveStaffPermissions } from "./enterpriseRoles/resolvePermissions";
import type { CustomStaffRole, StaffAccount } from "../types";

describe("custom roles manager", () => {
  it("filters pharmacy categories for retail business", () => {
    const cats = permissionCategoriesForBusiness("kiosk_duka");
    expect(cats.some((c) => c.id === "pharmacy")).toBe(false);
    expect(cats.some((c) => c.id === "sales")).toBe(true);
  });

  it("filters hospitality categories for pharmacy business", () => {
    const cats = permissionCategoriesForBusiness("pharmacy");
    expect(cats.some((c) => c.id === "hospitality")).toBe(false);
    expect(cats.some((c) => c.id === "pharmacy")).toBe(true);
  });

  it("resolves custom role permissions over base role", () => {
    const custom: CustomStaffRole = {
      id: "cr1",
      name: "Senior Cashier",
      inheritsFrom: "cashier",
      permissions: ["pos.sell", "reports.view"],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const staff: StaffAccount = {
      id: "s1",
      name: "Jane",
      role: "cashier",
      customRoleId: "cr1",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const perms = resolveStaffPermissions(staff, [custom]);
    expect(perms).toContain("reports.view");
    expect(perms).not.toContain("stock.adjust");
  });

  it("ignores disabled custom roles", () => {
    const custom: CustomStaffRole = {
      id: "cr1",
      name: "Disabled Role",
      inheritsFrom: "cashier",
      permissions: ["reports.view"],
      status: "disabled",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const staff: StaffAccount = {
      id: "s1",
      name: "Jane",
      role: "cashier",
      customRoleId: "cr1",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const perms = resolveStaffPermissions(staff, [custom]);
    expect(perms).not.toContain("reports.view");
  });

  it("clones permissions from industry template", () => {
    const tpl = permissionsFromTemplate({
      id: "retail_cashier",
      industries: ["retail"],
      baseRole: "cashier",
      labelKey: "roleTemplate_retail_cashier",
      descriptionKey: "staffRoleCashierDesc",
      Icon: {} as never,
      accent: "waka",
      rank: 40,
      allowedPermKeys: [],
      restrictedPermKeys: [],
    });
    expect(tpl.length).toBeGreaterThan(0);
    const draft = cloneCustomRoleFromTemplate(
      {
        id: "retail_cashier",
        industries: ["retail"],
        baseRole: "cashier",
        labelKey: "roleTemplate_retail_cashier",
        descriptionKey: "staffRoleCashierDesc",
        Icon: {} as never,
        accent: "waka",
        rank: 40,
        allowedPermKeys: [],
        restrictedPermKeys: [],
      },
      "Senior Cashier",
    );
    expect(draft.name).toBe("Senior Cashier");
    expect(draft.permissions.length).toBeGreaterThan(0);
  });

  it("counts staff assigned to custom role", () => {
    const staff: StaffAccount[] = [
      {
        id: "s1",
        name: "A",
        role: "cashier",
        customRoleId: "cr1",
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "s2",
        name: "B",
        role: "cashier",
        customRoleId: "cr1",
        active: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(countStaffWithCustomRole(staff, "cr1")).toBe(1);
  });

  it("summarizes permissions by category", () => {
    const rows = summarizePermissionsByCategory(["pos.sell", "stock.view", "reports.view"], "kiosk_duka");
    expect(rows.find((r) => r.id === "sales")?.count).toBe(1);
    expect(rows.find((r) => r.id === "inventory")?.count).toBe(1);
  });

  it("blocks assignment for disabled roles", () => {
    expect(
      isCustomRoleAssignable({
        id: "x",
        name: "X",
        inheritsFrom: "cashier",
        permissions: [],
        status: "disabled",
        createdAt: "",
        updatedAt: "",
      }),
    ).toBe(false);
  });
});
