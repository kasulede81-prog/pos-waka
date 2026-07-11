/**
 * Chart theme tokens — SVG-friendly CSS variable references.
 * Inline SVG elements can use stroke="hsl(var(--chart-grid))" etc.
 */

import { themeUi } from "./themeTokens";

/** Tailwind class for chart card shells */
export const chartShellClass = themeUi.chartShell;

/** CSS custom property names (HSL components, space-separated) */
export const chartCssVars = {
  grid: "--chart-grid",
  axis: "--chart-axis",
  label: "--chart-label",
  primary: "--chart-primary",
  primaryHover: "--chart-primary-hover",
  secondary: "--chart-secondary",
  areaFill: "--chart-area-fill",
  positive: "--chart-positive",
  negative: "--chart-negative",
  warning: "--chart-warning",
  neutral: "--chart-neutral",
  bg: "--chart-bg",
  hover: "--chart-hover",
  selection: "--chart-selection",
  track: "--chart-track",
  dotStroke: "--chart-dot-stroke",
  series1: "--chart-series-1",
  series2: "--chart-series-2",
  series3: "--chart-series-3",
  series4: "--chart-series-4",
  series5: "--chart-series-5",
} as const;

/** Inline SVG attribute values */
export const chartStroke = {
  grid: "hsl(var(--chart-grid))",
  axis: "hsl(var(--chart-axis))",
  primary: "hsl(var(--chart-primary))",
  secondary: "hsl(var(--chart-secondary))",
  positive: "hsl(var(--chart-positive))",
  negative: "hsl(var(--chart-negative))",
  warning: "hsl(var(--chart-warning))",
  neutral: "hsl(var(--chart-neutral))",
  label: "hsl(var(--chart-label))",
  track: "hsl(var(--chart-track))",
  selection: "hsl(var(--chart-selection))",
} as const;

export const chartFill = {
  primary: "hsl(var(--chart-primary))",
  areaStart: "hsl(var(--chart-primary) / 0.25)",
  areaEnd: "hsl(var(--chart-primary) / 0.02)",
  dot: "hsl(var(--chart-primary))",
  dotStroke: "hsl(var(--chart-dot-stroke))",
  positive: "hsl(var(--chart-positive))",
} as const;

/** Donut / pie series colors in display order */
export const chartSeriesFills = [
  "hsl(var(--chart-series-1))",
  "hsl(var(--chart-series-2))",
  "hsl(var(--chart-series-3))",
  "hsl(var(--chart-series-4))",
  "hsl(var(--chart-series-5))",
] as const;

/** Map legacy Tailwind color class hints to chart series CSS colors */
export function chartColorFromClassHint(colorClass: string): string {
  if (colorClass.includes("emerald")) return chartSeriesFills[0];
  if (colorClass.includes("sky")) return chartSeriesFills[1];
  if (colorClass.includes("violet")) return chartSeriesFills[2];
  if (colorClass.includes("amber")) return chartSeriesFills[3];
  return chartSeriesFills[4];
}

/** Read resolved HSL color for canvas/SVG export (optional) */
export function readChartCssColor(varName: string, fallback = "hsl(0 0% 50%)"): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  return `hsl(${raw})`;
}
