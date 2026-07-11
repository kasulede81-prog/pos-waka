import { describe, expect, it } from "vitest";
import {
  chartColorFromClassHint,
  chartCssVars,
  chartFill,
  chartSeriesFills,
  chartShellClass,
  chartStroke,
  readChartCssColor,
} from "./chartTokens";

describe("chartTokens", () => {
  it("exports CSS variable references for SVG strokes", () => {
    expect(chartStroke.primary).toBe("hsl(var(--chart-primary))");
    expect(chartStroke.grid).toBe("hsl(var(--chart-grid))");
    expect(chartFill.areaStart).toContain("--chart-primary");
  });

  it("lists all chart CSS var names", () => {
    expect(Object.keys(chartCssVars)).toContain("primary");
    expect(Object.keys(chartCssVars)).toContain("series1");
  });

  it("provides five series fill colors from CSS vars", () => {
    expect(chartSeriesFills).toHaveLength(5);
    for (const fill of chartSeriesFills) {
      expect(fill).toMatch(/^hsl\(var\(--chart-series-/);
    }
  });

  it("maps legacy Tailwind color hints to series fills", () => {
    expect(chartColorFromClassHint("bg-emerald-500")).toBe(chartSeriesFills[0]);
    expect(chartColorFromClassHint("text-sky-600")).toBe(chartSeriesFills[1]);
    expect(chartColorFromClassHint("unknown")).toBe(chartSeriesFills[4]);
  });

  it("uses semantic chart shell from themeUi", () => {
    expect(chartShellClass).toContain("border-border");
    expect(chartShellClass).toContain("bg-card");
  });

  it("readChartCssColor falls back outside document", () => {
    expect(readChartCssColor("--chart-primary", "hsl(0 0% 50%)")).toBe("hsl(0 0% 50%)");
  });
});
