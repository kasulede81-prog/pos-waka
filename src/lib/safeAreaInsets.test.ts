import { describe, expect, it } from "vitest";
import { visualViewportKeyboardGap } from "./safeAreaInsets";

describe("visualViewportKeyboardGap", () => {
  it("returns 0 when viewport fills layout", () => {
    expect(visualViewportKeyboardGap(800, 800, 0)).toBe(0);
  });

  it("measures keyboard from height shrink", () => {
    expect(visualViewportKeyboardGap(800, 420, 0)).toBe(380);
  });

  it("does not under-count when Android scrolls layout (offsetTop inflates)", () => {
    expect(visualViewportKeyboardGap(800, 420, 300)).toBe(380);
  });
});
