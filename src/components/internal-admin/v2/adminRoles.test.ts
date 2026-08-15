import { describe, expect, it } from "vitest";
import { adminPermissions, canRemoteSupport } from "./adminRoles";

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
  });
});
