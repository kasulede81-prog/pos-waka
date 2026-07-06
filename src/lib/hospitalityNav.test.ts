import { describe, expect, it } from "vitest";
import { hospitalityNavItemActive, isHospitalityOperationalRoute } from "./hospitalityNav";

describe("hospitalityNav", () => {
  it("detects operational routes", () => {
    expect(isHospitalityOperationalRoute("/floor")).toBe(true);
    expect(isHospitalityOperationalRoute("/floor/reservations")).toBe(true);
    expect(isHospitalityOperationalRoute("/floor/order/abc")).toBe(true);
    expect(isHospitalityOperationalRoute("/kitchen")).toBe(true);
    expect(isHospitalityOperationalRoute("/expo")).toBe(true);
    expect(isHospitalityOperationalRoute("/reports")).toBe(true);
    expect(isHospitalityOperationalRoute("/pos")).toBe(false);
    expect(isHospitalityOperationalRoute("/settings")).toBe(false);
  });

  it("highlights floor and reservations independently", () => {
    expect(hospitalityNavItemActive("/floor", "/floor")).toBe(true);
    expect(hospitalityNavItemActive("/floor", "/floor/order/x")).toBe(true);
    expect(hospitalityNavItemActive("/floor", "/floor/reservations")).toBe(false);
    expect(hospitalityNavItemActive("/floor/reservations", "/floor/reservations")).toBe(true);
  });
});
