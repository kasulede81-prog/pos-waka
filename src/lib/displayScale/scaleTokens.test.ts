import { describe, expect, it } from "vitest";
import {
  catalogColumnDeltaForScale,
  clampDisplayScaleLevel,
  displayScaleCssVars,
  DISPLAY_SCALE_LEVELS,
  DISPLAY_SCALE_META,
  stepDisplayScaleLevel,
} from "./scaleTokens";

describe("displayScaleCssVars", () => {
  it("scales font and spacing tokens proportionally", () => {
    const normal = displayScaleCssVars("normal");
    const large = displayScaleCssVars("large");
    expect(parseFloat(normal["--ds-font-base"])).toBeCloseTo(0.875, 3);
    expect(parseFloat(large["--ds-font-base"])).toBeGreaterThan(parseFloat(normal["--ds-font-base"]));
    expect(large["--ds-touch-min"]).toBe("54px");
  });

  it("never shrinks touch targets below 48px", () => {
    const compact = displayScaleCssVars("compact");
    expect(compact["--ds-touch-min"]).toBe("48px");
    expect(compact["--ds-input-min-h"]).toBe("48px");
  });
});

describe("stepDisplayScaleLevel", () => {
  it("steps through all four levels", () => {
    expect(stepDisplayScaleLevel("compact", 1)).toBe("normal");
    expect(stepDisplayScaleLevel("normal", 1)).toBe("large");
    expect(stepDisplayScaleLevel("large", 1)).toBe("extra_large");
    expect(stepDisplayScaleLevel("compact", -1)).toBe("compact");
    expect(stepDisplayScaleLevel("extra_large", 1)).toBe("extra_large");
  });
});

describe("clampDisplayScaleLevel", () => {
  it("falls back to normal for invalid values", () => {
    expect(clampDisplayScaleLevel(null)).toBe("normal");
    expect(clampDisplayScaleLevel("zoom")).toBe("normal");
    expect(clampDisplayScaleLevel("large")).toBe("large");
  });
});

describe("catalogColumnDeltaForScale", () => {
  it("matches meta column deltas", () => {
    for (const level of DISPLAY_SCALE_LEVELS) {
      expect(catalogColumnDeltaForScale(level)).toBe(DISPLAY_SCALE_META[level].columnDelta);
    }
  });
});
