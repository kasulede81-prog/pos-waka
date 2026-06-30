import { describe, expect, it } from "vitest";
import { formatMonthLabelKampala, formatMonthYearLabelKampala } from "./dateFilterLabels";

describe("formatMonthLabelKampala", () => {
  it("returns long month name for YYYY-MM", () => {
    expect(formatMonthLabelKampala("2026-06", "en")).toBe("June");
    expect(formatMonthYearLabelKampala("2026-06", "en")).toMatch(/June.*2026/);
  });
});
