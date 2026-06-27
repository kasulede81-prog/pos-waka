import { describe, expect, it } from "vitest";
import { catalogColumnCount, POS_GRID_MAX_COLUMNS } from "./posProductGridColumns";

describe("catalogColumnCount", () => {
  it("never exceeds twelve columns", () => {
    expect(catalogColumnCount(4000)).toBe(POS_GRID_MAX_COLUMNS);
  });

  it("returns 3 columns below 520px catalog width", () => {
    expect(catalogColumnCount(0)).toBe(3);
    expect(catalogColumnCount(519)).toBe(3);
  });

  it("returns 4 columns from 520px", () => {
    expect(catalogColumnCount(520)).toBe(4);
    expect(catalogColumnCount(639)).toBe(4);
  });

  it("returns 5 columns from 640px", () => {
    expect(catalogColumnCount(640)).toBe(5);
    expect(catalogColumnCount(819)).toBe(5);
  });

  it("returns 6 columns from 820px", () => {
    expect(catalogColumnCount(820)).toBe(6);
    expect(catalogColumnCount(979)).toBe(6);
  });

  it("returns 8 columns from 980px (1366 laptop catalog)", () => {
    expect(catalogColumnCount(980)).toBe(8);
    expect(catalogColumnCount(1159)).toBe(8);
  });

  it("returns 9 columns from 1160px (1600 display catalog)", () => {
    expect(catalogColumnCount(1160)).toBe(9);
    expect(catalogColumnCount(1399)).toBe(9);
  });

  it("returns 10 columns from 1400px (1920 display catalog)", () => {
    expect(catalogColumnCount(1400)).toBe(10);
    expect(catalogColumnCount(1899)).toBe(10);
  });

  it("returns 12 columns from 1900px (ultrawide catalog)", () => {
    expect(catalogColumnCount(1900)).toBe(12);
    expect(catalogColumnCount(3200)).toBe(12);
  });
});
