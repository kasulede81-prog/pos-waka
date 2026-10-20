import { describe, expect, it } from "vitest";
import {
  canOpenBusinessTools,
  HOSPITALITY_BUSINESS_TOOLS_ROUTE,
  HOSPITALITY_NAV_CATALOG,
  hospitalityNavItemActive,
  isHospitalityOperationalRoute,
  visibleHospitalityNavItems,
} from "./hospitalityNav";

describe("hospitalityNav", () => {
  it("detects operational routes", () => {
    expect(isHospitalityOperationalRoute("/hospitality")).toBe(true);
    expect(isHospitalityOperationalRoute("/hospitality/tools")).toBe(true);
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

  it("exposes a Home/Dashboard item to floor-capable staff only", () => {
    const home = HOSPITALITY_NAV_CATALOG.find((item) => item.path === "/hospitality");
    expect(home?.labelKey).toBe("navHome");
    expect(home?.perm).toBe("hospitality.floor");
    expect(hospitalityNavItemActive("/hospitality", "/hospitality")).toBe(true);
    expect(hospitalityNavItemActive("/hospitality", "/floor")).toBe(false);
    expect(
      hospitalityNavItemActive(HOSPITALITY_BUSINESS_TOOLS_ROUTE, "/hospitality/tools"),
    ).toBe(true);

    const floorStaff = visibleHospitalityNavItems({
      hasPerm: (perm) => perm === "hospitality.floor",
      kitchenEnabled: true,
      barOnly: false,
    });
    expect(floorStaff.some((item) => item.path === "/hospitality")).toBe(true);

    const kitchenOnly = visibleHospitalityNavItems({
      hasPerm: (perm) => perm === "hospitality.kitchen",
      kitchenEnabled: true,
      barOnly: false,
    });
    expect(kitchenOnly.some((item) => item.path === "/hospitality")).toBe(false);
  });

  it("makes the shared business tools reachable only with a launcher permission", () => {
    expect(canOpenBusinessTools((perm) => perm === "pos.sell")).toBe(true);
    expect(canOpenBusinessTools((perm) => perm === "settings.view")).toBe(true);
    expect(canOpenBusinessTools((perm) => perm === "hospitality.kitchen")).toBe(false);

    const waiter = visibleHospitalityNavItems({
      hasPerm: (perm) => perm === "pos.sell",
      kitchenEnabled: true,
      barOnly: false,
    });
    expect(waiter.some((item) => item.path === HOSPITALITY_BUSINESS_TOOLS_ROUTE)).toBe(true);

    const kitchenOnly = visibleHospitalityNavItems({
      hasPerm: (perm) => perm === "hospitality.kitchen",
      kitchenEnabled: true,
      barOnly: false,
    });
    expect(kitchenOnly.some((item) => item.path === HOSPITALITY_BUSINESS_TOOLS_ROUTE)).toBe(false);
  });
});
