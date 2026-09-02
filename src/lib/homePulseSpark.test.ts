import { describe, expect, it } from "vitest";
import {
  homePulseSparkArea,
  homePulseSparkCoords,
  homePulseSparkDayLabel,
  homePulseSparkHasActivity,
  homePulseSparkPolyline,
  homePulseSparkValues,
} from "./homePulseSpark";

describe("homePulseSpark", () => {
  const week = [
    { day: "2026-08-27", revenueUgx: 0, transactionCount: 0 },
    { day: "2026-08-28", revenueUgx: 100_000, transactionCount: 2 },
    { day: "2026-08-29", revenueUgx: 200_000, transactionCount: 4 },
  ];

  it("plots existing revenue or transaction counts without inventing values", () => {
    expect(homePulseSparkValues(week, "revenue")).toEqual([0, 100_000, 200_000]);
    expect(homePulseSparkValues(week, "transactions")).toEqual([0, 2, 4]);
  });

  it("keeps empty days on the baseline", () => {
    const coords = homePulseSparkCoords([0, 0, 0], 100, 40, 4);
    expect(coords).toHaveLength(3);
    expect(coords.every((point) => point.y === 36)).toBe(true);
    expect(homePulseSparkHasActivity([0, 0, 0])).toBe(false);
    expect(homePulseSparkDayLabel("2026-08-27")).toBe("8/27");
  });

  it("places the peak at the top pad and builds a polyline from those coords", () => {
    const coords = homePulseSparkCoords([0, 50, 100], 100, 40, 4);
    expect(coords[0]?.y).toBe(36);
    expect(coords[2]?.y).toBe(4);
    const line = homePulseSparkPolyline(coords);
    expect(line.split(" ")).toHaveLength(3);
    expect(homePulseSparkArea(coords, 40, 4)).toContain("4.00,36.00");
  });

  it("does not invent points for an empty series", () => {
    expect(homePulseSparkCoords([], 100, 40)).toEqual([]);
    expect(homePulseSparkPolyline([])).toBe("");
    expect(homePulseSparkArea([], 40)).toBe("");
  });
});
