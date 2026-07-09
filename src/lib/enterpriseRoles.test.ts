import { describe, expect, it } from "vitest";
import { resolveRoleIndustry, roleTemplatesForBusinessType } from "./enterpriseRoles";

describe("enterprise role templates", () => {
  it("pharmacy excludes hospitality-only roles", () => {
    const templates = roleTemplatesForBusinessType("pharmacy");
    const ids = templates.map((t) => t.id);
    expect(ids).toContain("pharmacist");
    expect(ids).toContain("pharmacy_cashier");
    expect(ids).not.toContain("hospitality_waiter");
    expect(ids).not.toContain("hospitality_kitchen_staff");
    expect(templates.every((t) => t.baseRole !== "waiter" && t.baseRole !== "kitchen" && t.baseRole !== "bar")).toBe(
      true,
    );
  });

  it("hospitality excludes pharmacy-specific labels but may share base roles", () => {
    const templates = roleTemplatesForBusinessType("restaurant");
    const ids = templates.map((t) => t.id);
    expect(ids).toContain("hospitality_waiter");
    expect(ids).not.toContain("pharmacist");
    expect(ids).not.toContain("pharmacy_technician");
  });

  it("retail excludes waiter kitchen bar templates", () => {
    const templates = roleTemplatesForBusinessType("kiosk_duka");
    expect(templates.every((t) => !["waiter", "kitchen", "bar"].includes(t.baseRole))).toBe(true);
  });

  it("wholesale maps warehouse manager", () => {
    expect(resolveRoleIndustry("wholesale")).toBe("wholesale");
    const templates = roleTemplatesForBusinessType("wholesale");
    expect(templates.some((t) => t.id === "wholesale_warehouse_manager")).toBe(true);
  });
});
