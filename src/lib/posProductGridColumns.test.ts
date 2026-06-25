import { describe, expect, it } from "vitest";
import { catalogColumnCount, POS_GRID_MAX_COLUMNS } from "./posProductGridColumns";

describe("catalogColumnCount", () => {
  it("never exceeds eight columns", () => {
    expect(catalogColumnCount(4000)).toBe(POS_GRID_MAX_COLUMNS);
  });

  it("returns 3 columns below 640px catalog width", () => {
    expect(catalogColumnCount(0)).toBe(3);
    expect(catalogColumnCount(639)).toBe(3);
  });

  it("returns 4 columns from 640px (1024×768 full-width catalog)", () => {
    expect(catalogColumnCount(640)).toBe(4);
    expect(catalogColumnCount(819)).toBe(4);
  });

  it("returns 5 columns from 820px (1280×800)", () => {
    expect(catalogColumnCount(820)).toBe(5);
    expect(catalogColumnCount(999)).toBe(5);
  });

  it("returns 6 columns from 1000px", () => {
    expect(catalogColumnCount(1000)).toBe(6);
    expect(catalogColumnCount(1199)).toBe(6);
  });

  it("returns 7 columns from 1200px (1920×1080)", () => {
    expect(catalogColumnCount(1200)).toBe(7);
    expect(catalogColumnCount(1599)).toBe(7);
  });

  it("returns 8 columns from 1600px (ultrawide)", () => {
    expect(catalogColumnCount(1600)).toBe(8);
    expect(catalogColumnCount(3200)).toBe(8);
  });
});
