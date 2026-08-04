import { describe, expect, it } from "vitest";
import {
  clampVisionGrid,
  preferSubstreamForGrid,
  resolveDefaultVisionGrid,
  visionGridClass,
} from "./layouts";

describe("vision live layouts", () => {
  it("defaults grids by viewport", () => {
    expect(resolveDefaultVisionGrid(390)).toBe(1);
    expect(resolveDefaultVisionGrid(800)).toBe(4);
    expect(resolveDefaultVisionGrid(1280)).toBe(9);
    expect(resolveDefaultVisionGrid(1800)).toBe(16);
  });

  it("forces phone to single camera", () => {
    expect(clampVisionGrid(16, 12, true)).toBe(1);
  });

  it("clamps dense grids when few cameras", () => {
    expect(clampVisionGrid(16, 3, false)).toBe(4);
    expect(clampVisionGrid(9, 2, false)).toBe(2);
  });

  it("prefers substream on dense grids", () => {
    expect(preferSubstreamForGrid(4)).toBe(false);
    expect(preferSubstreamForGrid(9)).toBe(true);
    expect(preferSubstreamForGrid(16)).toBe(true);
  });

  it("returns responsive grid classes", () => {
    expect(visionGridClass(1)).toContain("grid-cols-1");
    expect(visionGridClass(16)).toContain("xl:grid-cols-4");
  });
});
