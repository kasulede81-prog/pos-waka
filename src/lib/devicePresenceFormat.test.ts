import { describe, expect, it } from "vitest";
import {
  formatDeviceDisplayName,
  formatDevicePlatformLabel,
  formatLastActiveRelative,
} from "./devicePresenceFormat";

describe("formatDevicePlatformLabel", () => {
  it("maps known platforms", () => {
    expect(formatDevicePlatformLabel("android")).toBe("Android");
    expect(formatDevicePlatformLabel("electron")).toBe("Windows");
    expect(formatDevicePlatformLabel("web")).toBe("Web");
  });
});

describe("formatDeviceDisplayName", () => {
  it("prefers label when set", () => {
    expect(formatDeviceDisplayName("Samsung A15", "android")).toBe("Samsung A15");
  });

  it("falls back to platform POS", () => {
    expect(formatDeviceDisplayName(null, "android")).toBe("Android POS");
  });
});

describe("formatLastActiveRelative", () => {
  const now = Date.parse("2026-06-02T12:00:00.000Z");

  it("returns just_now under one minute", () => {
    expect(formatLastActiveRelative("2026-06-02T11:59:30.000Z", now)).toEqual({ key: "just_now" });
  });

  it("returns mins and hours", () => {
    expect(formatLastActiveRelative("2026-06-02T11:55:00.000Z", now)).toEqual({ key: "mins", count: 5 });
    expect(formatLastActiveRelative("2026-06-02T10:00:00.000Z", now)).toEqual({ key: "hours", count: 2 });
  });

  it("returns yesterday and days", () => {
    expect(formatLastActiveRelative("2026-06-01T12:00:00.000Z", now)).toEqual({ key: "yesterday" });
    expect(formatLastActiveRelative("2026-05-03T12:00:00.000Z", now)).toEqual({ key: "days", count: 30 });
  });

  it("returns never for missing iso", () => {
    expect(formatLastActiveRelative(null, now)).toEqual({ key: "never" });
  });
});
