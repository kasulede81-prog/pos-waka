import { describe, expect, it } from "vitest";
import {
  compareVersionStrings,
  isBelowMinimumVersionCode,
  isPlayUpdateAvailable,
  parseVersionCode,
} from "./appReleaseVersion";

describe("parseVersionCode", () => {
  it("parses build strings", () => {
    expect(parseVersionCode("17")).toBe(17);
    expect(parseVersionCode(18)).toBe(18);
    expect(parseVersionCode("")).toBe(0);
  });
});

describe("compareVersionStrings", () => {
  it("orders semver segments", () => {
    expect(compareVersionStrings("2.0.0", "2.3.0")).toBeLessThan(0);
    expect(compareVersionStrings("2.3.0", "2.3.0")).toBe(0);
    expect(compareVersionStrings("2.4.0", "2.3.9")).toBeGreaterThan(0);
  });
});

describe("isBelowMinimumVersionCode", () => {
  it("blocks when force enabled and below minimum", () => {
    expect(isBelowMinimumVersionCode(16, 17, true)).toBe(true);
    expect(isBelowMinimumVersionCode(17, 17, true)).toBe(false);
    expect(isBelowMinimumVersionCode(16, 17, false)).toBe(false);
  });
});

describe("isPlayUpdateAvailable", () => {
  it("detects newer play version", () => {
    expect(isPlayUpdateAvailable(17, 18)).toBe(true);
    expect(isPlayUpdateAvailable(18, 18)).toBe(false);
    expect(isPlayUpdateAvailable(19, 18)).toBe(false);
  });
});
