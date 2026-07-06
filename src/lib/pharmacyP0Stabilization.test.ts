import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";
import type { UserRole } from "../types";

describe("pharmacy P0 — permission matrix", () => {
  const pharmacyRoles: UserRole[] = ["owner", "manager", "cashier", "stock_keeper", "supervisor"];
  const nonPharmacyRoles: UserRole[] = ["waiter", "kitchen", "bar"];

  it("operational pharmacy roles have pharmacy.access", () => {
    for (const role of pharmacyRoles) {
      expect(hasPermission(role, "pharmacy.access")).toBe(true);
    }
  });

  it("hospitality-only roles lack pharmacy.access", () => {
    for (const role of nonPharmacyRoles) {
      expect(hasPermission(role, "pharmacy.access")).toBe(false);
    }
  });

  it("dispensing requires pos.sell for cashier and owner", () => {
    expect(hasPermission("cashier", "pos.sell")).toBe(true);
    expect(hasPermission("owner", "pos.sell")).toBe(true);
    expect(hasPermission("stock_keeper", "pos.sell")).toBe(false);
  });

  it("compliance reports require reports.view", () => {
    expect(hasPermission("cashier", "reports.view")).toBe(false);
    expect(hasPermission("manager", "reports.view")).toBe(true);
  });
});
