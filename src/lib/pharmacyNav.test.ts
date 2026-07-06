import { describe, expect, it } from "vitest";
import {
  PHARMACY_DISPENSE_ROUTE,
  PHARMACY_HOME_ROUTE,
  PHARMACY_PRESCRIPTIONS_ROUTE,
  isPharmacyOperationalRoute,
  pharmacyNavItemActive,
} from "./pharmacyNav";

describe("pharmacyNav", () => {
  it("detects operational routes", () => {
    expect(isPharmacyOperationalRoute(PHARMACY_HOME_ROUTE)).toBe(true);
    expect(isPharmacyOperationalRoute(PHARMACY_DISPENSE_ROUTE)).toBe(true);
    expect(isPharmacyOperationalRoute(PHARMACY_PRESCRIPTIONS_ROUTE)).toBe(true);
    expect(isPharmacyOperationalRoute("/pharmacy/dispense")).toBe(true);
    expect(isPharmacyOperationalRoute("/pharmacy/patients")).toBe(true);
    expect(isPharmacyOperationalRoute("/pharmacy/inventory")).toBe(true);
    expect(isPharmacyOperationalRoute("/pharmacy/inventory?tab=purchases")).toBe(false);
    expect(isPharmacyOperationalRoute("/pharmacy/purchases")).toBe(true);
    expect(isPharmacyOperationalRoute("/pharmacy/reports")).toBe(true);
    expect(isPharmacyOperationalRoute("/pharmacy/returns")).toBe(true);
    expect(isPharmacyOperationalRoute("/pharmacy/settings")).toBe(true);
    expect(isPharmacyOperationalRoute("/pos")).toBe(false);
    expect(isPharmacyOperationalRoute("/stock")).toBe(false);
    expect(isPharmacyOperationalRoute("/floor")).toBe(false);
  });

  it("highlights inventory and purchases together", () => {
    expect(pharmacyNavItemActive("/pharmacy/inventory", "/pharmacy/inventory")).toBe(true);
    expect(pharmacyNavItemActive("/pharmacy/inventory", "/pharmacy/purchases")).toBe(true);
    expect(pharmacyNavItemActive(PHARMACY_HOME_ROUTE, PHARMACY_DISPENSE_ROUTE)).toBe(false);
    expect(pharmacyNavItemActive(PHARMACY_HOME_ROUTE, PHARMACY_HOME_ROUTE)).toBe(true);
  });
});
