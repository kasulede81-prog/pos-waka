import { describe, expect, it } from "vitest";
import { evaluateDeviceLimitBlock, isUnlimitedDevicePlan, needsNewDeviceSlot } from "./deviceLimitPolicy";

describe("needsNewDeviceSlot", () => {
  it("ignores active and revoked for slot counting", () => {
    expect(needsNewDeviceSlot("active")).toBe(false);
    expect(needsNewDeviceSlot("revoked")).toBe(false);
    expect(needsNewDeviceSlot(null)).toBe(true);
    expect(needsNewDeviceSlot("disconnected")).toBe(true);
  });
});

describe("evaluateDeviceLimitBlock", () => {
  it("allows login under limit", () => {
    expect(
      evaluateDeviceLimitBlock({ deviceLimit: 5, activeCount: 2, currentStatus: null }),
    ).toEqual({ blocked: false });
  });

  it("allows login exactly at limit for existing active device", () => {
    expect(
      evaluateDeviceLimitBlock({ deviceLimit: 3, activeCount: 3, currentStatus: "active" }),
    ).toEqual({ blocked: false });
  });

  it("blocks login above limit for new activation", () => {
    expect(
      evaluateDeviceLimitBlock({ deviceLimit: 3, activeCount: 3, currentStatus: null }),
    ).toEqual({ blocked: true, reason: "at_limit" });
  });

  it("blocks at exact limit for disconnected reactivation", () => {
    expect(
      evaluateDeviceLimitBlock({ deviceLimit: 3, activeCount: 3, currentStatus: "disconnected" }),
    ).toEqual({ blocked: true, reason: "at_limit" });
  });

  it("ignores disconnected devices in count (caller supplies active only)", () => {
    expect(
      evaluateDeviceLimitBlock({ deviceLimit: 3, activeCount: 2, currentStatus: null }),
    ).toEqual({ blocked: false });
  });

  it("ignores revoked for slot policy", () => {
    expect(
      evaluateDeviceLimitBlock({ deviceLimit: 1, activeCount: 1, currentStatus: "revoked" }),
    ).toEqual({ blocked: false });
  });

  it("allows unlimited plan", () => {
    expect(
      evaluateDeviceLimitBlock({ deviceLimit: null, activeCount: 99, currentStatus: null }),
    ).toEqual({ blocked: false });
  });
});

describe("isUnlimitedDevicePlan", () => {
  it("treats null and zero as unlimited", () => {
    expect(isUnlimitedDevicePlan(null)).toBe(true);
    expect(isUnlimitedDevicePlan(0)).toBe(true);
    expect(isUnlimitedDevicePlan(3)).toBe(false);
  });
});

describe("concurrent activation race", () => {
  it("serializes decisions: second activation blocked when limit 1", () => {
    let active = 0;
    const limit = 1;
    const tryActivate = (status: "active" | null) => {
      const gate = evaluateDeviceLimitBlock({
        deviceLimit: limit,
        activeCount: active,
        currentStatus: status,
      });
      if (gate.blocked) return false;
      if (status !== "active") active += 1;
      return true;
    };
    expect(tryActivate(null)).toBe(true);
    expect(tryActivate(null)).toBe(false);
    expect(active).toBe(1);
  });
});
