import { describe, expect, it } from "vitest";
import { weekStartKeyKampala } from "../datesUg";
import {
  addDaysYmd,
  consecutiveCalendarWeeks,
  formatWeekComparisonDisplay,
  kampalaToday,
  lastCalendarWeek,
  mondayOfKampalaWeek,
  periodForWeekScope,
  sundayOfKampalaWeek,
  thisCalendarWeek,
  weeksAreConsecutive,
  weeksHaveNoGap,
  weeksHaveNoOverlap,
  weekChange,
  zeroPeriodMessage,
  zeroSalesConfirmed,
} from "./askWakaPeriods";

/** Thursday 13 Aug 2026 12:00 UTC = Thursday afternoon Kampala. */
const THU_2026_08_13 = new Date("2026-08-13T12:00:00.000Z");
/** Sunday 9 Aug 2026 21:00 UTC = Monday 10 Aug 00:00 Kampala. */
const SUNDAY_NIGHT_TO_MONDAY = new Date("2026-08-09T21:00:00.000Z");
/** Sunday 9 Aug 2026 18:00 UTC = Sunday 21:00 Kampala. */
const SUNDAY_EVENING_KAMPALA = new Date("2026-08-09T18:00:00.000Z");

describe("Ask WAKA calendar weeks", () => {
  it("1. current calendar week is Monday–Sunday in Kampala", () => {
    const w = thisCalendarWeek(THU_2026_08_13);
    expect(w.start_day).toBe("2026-08-10");
    expect(w.end_day).toBe("2026-08-16");
    expect(w.week_scope).toBe("this");
    expect(w.in_progress).toBe(true);
    expect(w.label).toContain("This week");
    expect(w.label).toContain("in progress");
  });

  it("2. previous calendar week is the immediately preceding Monday–Sunday", () => {
    const w = lastCalendarWeek(THU_2026_08_13);
    expect(w.start_day).toBe("2026-08-03");
    expect(w.end_day).toBe("2026-08-09");
    expect(w.in_progress).toBe(false);
    expect(w.label).toContain("Last week");
    expect(w.label).not.toContain("in progress");
  });

  it("3. consecutive week boundaries", () => {
    const { thisWeek, lastWeek } = consecutiveCalendarWeeks(THU_2026_08_13);
    expect(weeksAreConsecutive(lastWeek, thisWeek)).toBe(true);
    expect(addDaysYmd(lastWeek.end_day, 1)).toBe(thisWeek.start_day);
    expect(addDaysYmd(thisWeek.start_day, 6)).toBe(thisWeek.end_day);
    expect(addDaysYmd(lastWeek.start_day, 6)).toBe(lastWeek.end_day);
  });

  it("4. Sunday/Monday boundary follows Kampala + Monday-start convention", () => {
    expect(kampalaToday(SUNDAY_EVENING_KAMPALA)).toBe("2026-08-09");
    expect(mondayOfKampalaWeek("2026-08-09")).toBe("2026-08-03");
    expect(sundayOfKampalaWeek("2026-08-09")).toBe("2026-08-09");

    expect(kampalaToday(SUNDAY_NIGHT_TO_MONDAY)).toBe("2026-08-10");
    const afterMidnight = thisCalendarWeek(SUNDAY_NIGHT_TO_MONDAY);
    expect(afterMidnight.start_day).toBe("2026-08-10");
    expect(afterMidnight.end_day).toBe("2026-08-16");

    const stillSunday = thisCalendarWeek(SUNDAY_EVENING_KAMPALA);
    expect(stillSunday.start_day).toBe("2026-08-03");
    expect(stillSunday.end_day).toBe("2026-08-09");

    expect(mondayOfKampalaWeek("2026-08-13")).toBe(weekStartKeyKampala("2026-08-13T12:00:00.000Z"));
  });

  it("5. partial current week is marked in progress", () => {
    const w = thisCalendarWeek(THU_2026_08_13);
    expect(w.in_progress).toBe(true);
    expect(w.start_day).toBe("2026-08-10");
    expect(w.end_day).toBe("2026-08-16");
  });

  it("6. zero-sales week is a confirmed zero, not unknown", () => {
    expect(zeroSalesConfirmed(0, 0)).toBe(true);
    expect(zeroSalesConfirmed("0", "0")).toBe(true);
    expect(zeroSalesConfirmed(44000, 3)).toBe(false);
    const period = lastCalendarWeek(THU_2026_08_13);
    expect(zeroPeriodMessage(period, "sales")).toBe("No sales were recorded for Aug 3–Aug 9.");
  });

  it("7. week containing historical sales (2026-07-23) is a distinct calendar week", () => {
    const salesDay = "2026-07-23";
    expect(mondayOfKampalaWeek(salesDay)).toBe("2026-07-20");
    expect(sundayOfKampalaWeek(salesDay)).toBe("2026-07-26");
    const { thisWeek, lastWeek } = consecutiveCalendarWeeks(THU_2026_08_13);
    expect(salesDay < lastWeek.start_day).toBe(true);
    expect(thisWeek.start_day).toBe("2026-08-10");
    expect(lastWeek.start_day).toBe("2026-08-03");
  });

  it("8. compare current vs previous week", () => {
    const { thisWeek, lastWeek } = consecutiveCalendarWeeks(THU_2026_08_13);
    expect(periodForWeekScope("this", THU_2026_08_13).start_day).toBe(thisWeek.start_day);
    expect(periodForWeekScope("last", THU_2026_08_13).start_day).toBe(lastWeek.start_day);
    const display = formatWeekComparisonDisplay({
      thisWeek,
      lastWeek,
      thisRevenue: 0,
      lastRevenue: 0,
    });
    expect(display.this_week_line).toContain("UGX 0");
    expect(display.last_week_line).toContain("UGX 0");
    expect(display.change_line).toContain("UGX 0");
    expect(display.change_line).toContain("0%");
    expect(weekChange(100, 0).change_pct).toBeNull();
    expect(weekChange(0, 0).change_pct).toBe(0);
  });

  it("9. no date overlap", () => {
    const { thisWeek, lastWeek } = consecutiveCalendarWeeks(THU_2026_08_13);
    expect(weeksHaveNoOverlap(thisWeek, lastWeek)).toBe(true);
  });

  it("10. no date gap", () => {
    const { thisWeek, lastWeek } = consecutiveCalendarWeeks(THU_2026_08_13);
    expect(weeksHaveNoGap(lastWeek, thisWeek)).toBe(true);
  });
});
