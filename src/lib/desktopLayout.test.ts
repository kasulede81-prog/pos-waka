import { describe, expect, it } from "vitest";
import { adminKpiGridClass, dashboardKpiGridClass, historyHeroMetricGridClass } from "./desktopLayout";

describe("desktopLayout", () => {
  it("stacks hero metrics on narrow widths", () => {
    expect(historyHeroMetricGridClass(3)).toContain("grid-cols-1");
    expect(historyHeroMetricGridClass(3)).toContain("lg:grid-cols-3");
  });

  it("dashboard KPI grid scales to four columns on xl", () => {
    expect(dashboardKpiGridClass()).toContain("xl:grid-cols-4");
  });

  it("admin KPI grid uses six columns on xl", () => {
    expect(adminKpiGridClass()).toContain("xl:grid-cols-6");
  });
});
