import { describe, expect, it } from "vitest";
import {
  isFloorPlanHomeRoute,
  isOperationalViewportRoute,
  resolveEnterpriseBottomChrome,
} from "./enterpriseBottomChrome";

describe("resolveEnterpriseBottomChrome", () => {
  it("returns none on desktop layout", () => {
    const state = resolveEnterpriseBottomChrome({
      pathname: "/pharmacy/inventory",
      terminalHome: "/",
      isDesktopLayout: true,
      pharmacyWorkspace: true,
      hospitalityBusiness: false,
    });
    expect(state.mode).toBe("none");
    expect(state.showMobileBar).toBe(false);
  });

  it("uses floor mode on /floor home", () => {
    const state = resolveEnterpriseBottomChrome({
      pathname: "/floor",
      terminalHome: "/floor",
      isDesktopLayout: false,
      pharmacyWorkspace: false,
      hospitalityBusiness: true,
    });
    expect(state.mode).toBe("floor");
    expect(state.shellClass).toBe("app-shell--floor-nav");
    expect(state.showMobileBar).toBe(false);
  });

  it("uses pharmacy mode on pharmacy routes", () => {
    const state = resolveEnterpriseBottomChrome({
      pathname: "/pharmacy/patients",
      terminalHome: "/",
      isDesktopLayout: false,
      pharmacyWorkspace: true,
      hospitalityBusiness: false,
    });
    expect(state.mode).toBe("pharmacy");
    expect(state.showMobileBar).toBe(true);
  });

  it("hides chrome on table order", () => {
    expect(isOperationalViewportRoute("/floor/order/abc")).toBe(true);
    const state = resolveEnterpriseBottomChrome({
      pathname: "/floor/order/abc",
      terminalHome: "/floor",
      isDesktopLayout: false,
      pharmacyWorkspace: false,
      hospitalityBusiness: true,
    });
    expect(state.mode).toBe("none");
  });

  it("prefers floor over hospitality on floor home", () => {
    expect(isFloorPlanHomeRoute("/floor")).toBe(true);
    expect(isFloorPlanHomeRoute("/floor/reservations")).toBe(false);
  });
});
