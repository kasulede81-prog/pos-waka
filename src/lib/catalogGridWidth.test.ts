import { describe, expect, it } from "vitest";
import { catalogColumnCount, POS_GRID_MAX_COLUMNS, POS_CATALOG_COL_BREAKPOINT_520, POS_CATALOG_COL_BREAKPOINT_640, POS_CATALOG_COL_BREAKPOINT_820, POS_CATALOG_COL_BREAKPOINT_980, POS_CATALOG_COL_BREAKPOINT_1160, POS_CATALOG_COL_BREAKPOINT_1400, POS_CATALOG_COL_BREAKPOINT_1900 } from "./posProductGridColumns";

describe("catalog grid width → column count", () => {
  it("never exceeds twelve columns at any catalog width", () => {
    expect(catalogColumnCount(4000)).toBe(POS_GRID_MAX_COLUMNS);
    expect(POS_GRID_MAX_COLUMNS).toBe(12);
  });

  it("returns 3 columns below 520px catalog width", () => {
    expect(catalogColumnCount(0)).toBe(3);
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_520 - 1)).toBe(3);
  });

  it("returns 4 columns from 520–639px", () => {
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_520)).toBe(4);
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_640 - 1)).toBe(4);
  });

  it("returns 5 columns from 640–819px", () => {
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_640)).toBe(5);
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_820 - 1)).toBe(5);
  });

  it("returns 6 columns from 820–979px", () => {
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_820)).toBe(6);
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_980 - 1)).toBe(6);
  });

  it("returns 8 columns from 980–1159px", () => {
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_980)).toBe(8);
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_1160 - 1)).toBe(8);
  });

  it("returns 9 columns from 1160–1399px", () => {
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_1160)).toBe(9);
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_1400 - 1)).toBe(9);
  });

  it("returns 10 columns from 1400–1899px", () => {
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_1400)).toBe(10);
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_1900 - 1)).toBe(10);
  });

  it("returns 12 columns from 1900px catalog width (ultrawide desktop)", () => {
    expect(catalogColumnCount(POS_CATALOG_COL_BREAKPOINT_1900)).toBe(12);
    expect(catalogColumnCount(2560)).toBe(12);
  });
});
