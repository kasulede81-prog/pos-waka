import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { HomeExecutiveKpiStrip } from "../components/home/HomeExecutiveKpiStrip";
import { MobileHomeLiveEngine } from "../components/home/MobileHomeLiveEngine";
import { HOME_KPI_PLACEHOLDER } from "./homeKpiTrust";
import type { HomeExecutiveKpi } from "./homeExecutiveKpis";

const unavailableKpis: HomeExecutiveKpi[] = [
  {
    id: "sales",
    label: "Today's sales",
    value: HOME_KPI_PLACEHOLDER,
    hint: "Shop totals unavailable",
    tone: "default",
    to: "/reports",
    availability: "unavailable",
  },
];

describe("Home desktop and mobile KPI surfaces", () => {
  it("desktop executive strip renders overlay failure as an explicit placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(HomeExecutiveKpiStrip, { lang: "en", kpis: unavailableKpis })),
    );
    expect(html).toContain(HOME_KPI_PLACEHOLDER);
    expect(html).toContain("Shop totals unavailable");
    expect(html).toContain('data-home-kpi-availability="unavailable"');
    expect(html).not.toContain("UGX 0");
  });

  it("mobile live engine uses the same unavailable sell stat, not a plausible local total", () => {
    const html = renderToStaticMarkup(
      createElement(MobileHomeLiveEngine, {
        lang: "en",
        weekTrend: [],
        sparkMode: null,
        sellStat: {
          label: "Today's sales",
          value: HOME_KPI_PLACEHOLDER,
          trend: "Shop totals unavailable",
          intensity: "calm",
          availability: "unavailable",
        },
      }),
    );
    expect(html).toContain(HOME_KPI_PLACEHOLDER);
    expect(html).toContain('data-home-kpi-availability="unavailable"');
    expect(html).not.toContain("12 transactions");
  });

  it("desktop strip loading state is not a shop-wide zero", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(HomeExecutiveKpiStrip, {
          lang: "en",
          kpis: [
            {
              id: "sales",
              label: "Today's sales",
              value: HOME_KPI_PLACEHOLDER,
              hint: "Loading shop totals…",
              tone: "default",
              to: "/reports",
              availability: "loading",
            },
          ],
        }),
      ),
    );
    expect(html).toContain("Loading shop totals…");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("UGX 0");
  });
});
