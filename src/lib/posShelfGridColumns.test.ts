import { describe, expect, it } from "vitest";
import {
  POS_SHELF_MAX_COLUMNS,
  POS_SHELF_MIN_COLUMNS,
  shelfColumnCount,
  shelfGridTemplateColumns,
} from "./posShelfGridColumns";

describe("shelfColumnCount", () => {
  it("uses 2 columns on narrow phone portrait band", () => {
    expect(shelfColumnCount(320, { phoneBand: true, isLandscape: false })).toBe(2);
    expect(shelfColumnCount(390, { phoneBand: true, isLandscape: false })).toBe(2);
  });

  it("uses 3 columns on phone landscape band", () => {
    expect(shelfColumnCount(667, { phoneBand: true, isLandscape: true })).toBe(3);
  });

  it("grows past the legacy 6-column ceiling on wide catalogs", () => {
    expect(shelfColumnCount(1366)).toBeGreaterThan(6);
    expect(shelfColumnCount(1920)).toBeGreaterThan(6);
    expect(shelfColumnCount(2560)).toBeGreaterThanOrEqual(10);
  });

  it("never exceeds max columns", () => {
    expect(shelfColumnCount(8000)).toBe(POS_SHELF_MAX_COLUMNS);
  });

  it("never drops below min columns", () => {
    expect(shelfColumnCount(0)).toBe(POS_SHELF_MIN_COLUMNS);
    expect(shelfColumnCount(100)).toBe(POS_SHELF_MIN_COLUMNS);
  });

  it("keeps roughly stable tile width (~168px+) as columns grow", () => {
    for (const width of [1024, 1366, 1440, 1920, 2560]) {
      const cols = shelfColumnCount(width);
      const tile = (width - (cols - 1) * 8) / cols;
      expect(tile).toBeGreaterThanOrEqual(160);
    }
  });

  it("builds a CSS grid template from column count", () => {
    expect(shelfGridTemplateColumns(8)).toBe("repeat(8, minmax(0, 1fr))");
  });
});
