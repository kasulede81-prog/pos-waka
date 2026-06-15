import { describe, expect, it } from "vitest";
import { catalogColumnCount, POS_GRID_MAX_COLUMNS } from "./posProductGridColumns";

describe("catalog grid width → column count", () => {
  it("never exceeds six columns at any catalog width", () => {
    expect(catalogColumnCount(4000)).toBe(POS_GRID_MAX_COLUMNS);
    expect(POS_GRID_MAX_COLUMNS).toBe(6);
  });

  it("returns 3 columns below 700px catalog width", () => {
    expect(catalogColumnCount(0)).toBe(3);
    expect(catalogColumnCount(699)).toBe(3);
  });

  it("returns 4 columns from 700–899px", () => {
    expect(catalogColumnCount(700)).toBe(4);
    expect(catalogColumnCount(899)).toBe(4);
  });

  it("returns 5 columns from 900–1199px", () => {
    expect(catalogColumnCount(900)).toBe(5);
    expect(catalogColumnCount(1199)).toBe(5);
  });

  it("returns 6 columns from 1200px catalog width (typical desktop sidebar layout)", () => {
    expect(catalogColumnCount(1200)).toBe(6);
    expect(catalogColumnCount(1800)).toBe(6);
  });
});
