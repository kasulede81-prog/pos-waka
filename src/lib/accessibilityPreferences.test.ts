import { describe, expect, it } from "vitest";
import { DEFAULT_ACCESSIBILITY_PREFERENCES, parseAccessibilityPreferences } from "./accessibilityPreferences";

describe("parseAccessibilityPreferences", () => {
  it("uses safe defaults for invalid values", () => {
    expect(parseAccessibilityPreferences("not-json")).toEqual(DEFAULT_ACCESSIBILITY_PREFERENCES);
  });

  it("accepts supported preferences only", () => {
    expect(parseAccessibilityPreferences('{"reducedMotion":true,"textSize":"large","highContrast":true}')).toEqual({
      reducedMotion: true,
      textSize: "large",
      highContrast: true,
    });
    expect(parseAccessibilityPreferences('{"textSize":"giant"}').textSize).toBe("default");
  });
});
