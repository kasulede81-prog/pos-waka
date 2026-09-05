import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDateFilterBounds, type DateFilterValue } from "../../../lib/dateFilters";
import { t } from "../../../lib/i18n";
import { extendedPresetToFilter } from "./analyticsPageView";
import {
  presentReportsKpiSparkline,
  REPORTS_KPI_SPARKLINE_LABEL_KEY,
  reportsKpiSparklineOverlapsSelected,
  reportsRollingSevenDayBounds,
} from "./reportsKpiSparklineContext";

const SEVEN_POINTS = Array.from({ length: 7 }, (_, i) => ({ value: i + 1 }));

function presentForFilter(filter: DateFilterValue, extras: Partial<Parameters<typeof presentReportsKpiSparkline>[1]> = {}) {
  return presentReportsKpiSparkline(SEVEN_POINTS, {
    dataComplete: true,
    closedDayBreakdownUnavailable: false,
    selectedBounds: resolveDateFilterBounds(filter),
    ...extras,
  });
}

describe("RPT-P3-04 KPI sparkline context", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TEST 1 — sparkline context uses i18n Last 7 days", () => {
    expect(REPORTS_KPI_SPARKLINE_LABEL_KEY).toBe("baKpiSparklineLast7Days");
    expect(t("en", REPORTS_KPI_SPARKLINE_LABEL_KEY)).toBe("Last 7 days");
    expect(t("lg", REPORTS_KPI_SPARKLINE_LABEL_KEY)).toBe("Last 7 days");
  });

  it("TEST 2 — today overlaps rolling 7-day window; sparkline visible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const presented = presentForFilter({ kind: "preset", preset: "today" });
    expect(reportsKpiSparklineOverlapsSelected(resolveDateFilterBounds({ kind: "preset", preset: "today" }))).toBe(true);
    expect(presented).toBe(SEVEN_POINTS);
    expect(presented).toHaveLength(7);
  });

  it("TEST 3 — yesterday overlaps rolling 7-day window; sparkline visible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const presented = presentForFilter({ kind: "preset", preset: "yesterday" });
    expect(presented).toBe(SEVEN_POINTS);
  });

  it("TEST 4 — this month overlaps rolling window; sparkline visible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const presented = presentForFilter({ kind: "preset", preset: "this_month" });
    expect(presented).toBe(SEVEN_POINTS);
  });

  it("TEST 5 — last 7 days overlaps; sparkline visible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const filter = extendedPresetToFilter("last_7_days");
    const presented = presentForFilter(filter);
    expect(presented).toBe(SEVEN_POINTS);
  });

  it("TEST 6 — historical last month with no overlap hides sparkline", () => {
    vi.useFakeTimers();
    // Last month is September; rolling window is mid-October — no overlap.
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    const filter = extendedPresetToFilter("last_month");
    const bounds = resolveDateFilterBounds(filter);
    const window = reportsRollingSevenDayBounds();
    expect(bounds.toKey < window.fromKey).toBe(true);
    expect(presentForFilter(filter)).toEqual([]);
  });

  it("TEST 7 — historical custom January range while now is September hides sparkline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const presented = presentForFilter({ kind: "range", fromKey: "2026-01-01", toKey: "2026-01-31" });
    expect(presented).toEqual([]);
  });

  it("TEST 8 — custom range overlapping the rolling window shows sparkline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const presented = presentForFilter({ kind: "range", fromKey: "2026-09-01", toKey: "2026-09-10" });
    expect(presented).toBe(SEVEN_POINTS);
  });

  it("TEST 9 — this year contains the rolling window; sparkline visible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const presented = presentForFilter(extendedPresetToFilter("this_year"));
    expect(presented).toBe(SEVEN_POINTS);
  });

  it("TEST 10 — closed-day unavailable still suppresses the sparkline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const presented = presentForFilter(
      { kind: "preset", preset: "today" },
      { closedDayBreakdownUnavailable: true },
    );
    expect(presented).toEqual([]);
  });

  it("TEST 11 — incomplete hydration still suppresses the sparkline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const presented = presentForFilter({ kind: "preset", preset: "today" }, { dataComplete: false });
    expect(presented).toEqual([]);
  });
});
