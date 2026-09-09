import { describe, expect, it } from "vitest";
import {
  HOME_KPI_PLACEHOLDER,
  homeKpiAvailabilityHint,
  homeKpiOverlayRefreshIdentity,
  presentHomeKpiFormattedValue,
  presentHomeKpiStat,
  resolveHomeShopMonthAvailability,
  resolveHomeShopTodayAvailability,
  resolveHomeWeekSparkAvailability,
} from "./homeKpiTrust";

const copy = { loading: "Loading shop totals…", unavailable: "Shop totals unavailable" };

describe("homeKpiOverlayRefreshIdentity", () => {
  const base = {
    active: true,
    todayKey: "2026-09-09",
    monthKey: "2026-09",
    queueIdle: false,
    lastSuccessAt: "t1",
    lastPullAt: "p1",
  };

  it("does not change when only pendingCount depth would have changed (queue stays busy)", () => {
    const busyA = homeKpiOverlayRefreshIdentity(base);
    const busyB = homeKpiOverlayRefreshIdentity({ ...base, queueIdle: false });
    expect(busyA).toBe(busyB);
  });

  it("changes when the queue becomes idle (genuine catch-up)", () => {
    expect(homeKpiOverlayRefreshIdentity(base)).not.toBe(
      homeKpiOverlayRefreshIdentity({ ...base, queueIdle: true }),
    );
  });

  it("changes when a pull actually completes", () => {
    expect(homeKpiOverlayRefreshIdentity(base)).not.toBe(
      homeKpiOverlayRefreshIdentity({ ...base, lastPullAt: "p2" }),
    );
    expect(homeKpiOverlayRefreshIdentity(base)).not.toBe(
      homeKpiOverlayRefreshIdentity({ ...base, lastSuccessAt: "t2" }),
    );
  });
});

describe("resolveHomeShopTodayAvailability", () => {
  it("is loading while the shop overlay has not arrived", () => {
    expect(
      resolveHomeShopTodayAvailability({
        scope: "shop_wide",
        overlayExpected: true,
        overlayStatus: "loading",
        overlayHasToday: false,
        freezeToday: false,
      }),
    ).toBe("loading");
  });

  it("is unavailable when the overlay RPC failed", () => {
    expect(
      resolveHomeShopTodayAvailability({
        scope: "shop_wide",
        overlayExpected: true,
        overlayStatus: "unavailable",
        overlayHasToday: false,
        freezeToday: false,
      }),
    ).toBe("unavailable");
  });

  it("is ready when overlay today totals are present", () => {
    expect(
      resolveHomeShopTodayAvailability({
        scope: "shop_wide",
        overlayExpected: true,
        overlayStatus: "ready",
        overlayHasToday: true,
        freezeToday: false,
      }),
    ).toBe("ready");
  });

  it("does not treat a cashier personal KPI as waiting on the shop overlay", () => {
    expect(
      resolveHomeShopTodayAvailability({
        scope: "personal",
        overlayExpected: false,
        overlayStatus: "idle",
        overlayHasToday: false,
        freezeToday: false,
      }),
    ).toBe("ready");
  });

  it("keeps a closed-day freeze authoritative without the overlay", () => {
    expect(
      resolveHomeShopTodayAvailability({
        scope: "shop_wide",
        overlayExpected: true,
        overlayStatus: "loading",
        overlayHasToday: false,
        freezeToday: true,
      }),
    ).toBe("ready");
  });
});

describe("resolveHomeShopMonthAvailability", () => {
  it("hides incomplete local month totals while sales are hydrating and overlay is off", () => {
    expect(
      resolveHomeShopMonthAvailability({
        scope: "shop_wide",
        overlayExpected: false,
        overlayStatus: "idle",
        overlayHasMonth: false,
        salesHydrating: true,
        hydrationComplete: false,
      }),
    ).toBe("loading");
  });

  it("is unavailable when overlay was expected but failed", () => {
    expect(
      resolveHomeShopMonthAvailability({
        scope: "shop_wide",
        overlayExpected: true,
        overlayStatus: "unavailable",
        overlayHasMonth: false,
        salesHydrating: false,
        hydrationComplete: true,
      }),
    ).toBe("unavailable");
  });
});

describe("resolveHomeWeekSparkAvailability", () => {
  it("does not present a hydrating replica as a quiet week", () => {
    expect(resolveHomeWeekSparkAvailability({ salesHydrating: true, hydrationComplete: false })).toBe("loading");
    expect(resolveHomeWeekSparkAvailability({ salesHydrating: false, hydrationComplete: true })).toBe("ready");
  });
});

describe("presentHomeKpiStat", () => {
  const localStat = {
    label: "Today's sales",
    value: "12 transactions",
    intensity: "high" as const,
  };

  it("does not show incomplete local numbers as ready shop-wide totals", () => {
    const shown = presentHomeKpiStat(localStat, "loading", copy);
    expect(shown.value).toBe(HOME_KPI_PLACEHOLDER);
    expect(shown.value).not.toContain("12");
    expect(shown.trend).toBe(copy.loading);
    expect(shown.availability).toBe("loading");
  });

  it("surfaces overlay failure as unavailable, not a plausible zero", () => {
    const shown = presentHomeKpiStat({ ...localStat, value: "UGX 0" }, "unavailable", copy);
    expect(shown.value).toBe(HOME_KPI_PLACEHOLDER);
    expect(shown.trend).toBe(copy.unavailable);
    expect(shown.availability).toBe("unavailable");
  });

  it("keeps the formatted value when the KPI is ready", () => {
    expect(presentHomeKpiStat(localStat, "ready", copy).value).toBe("12 transactions");
    expect(presentHomeKpiFormattedValue("UGX 13,000", "ready")).toBe("UGX 13,000");
    expect(presentHomeKpiFormattedValue("UGX 13,000", "loading")).toBe(HOME_KPI_PLACEHOLDER);
    expect(homeKpiAvailabilityHint("unavailable", copy)).toBe(copy.unavailable);
  });
});
