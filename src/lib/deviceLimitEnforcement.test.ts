import { describe, expect, it } from "vitest";
import { evaluateDeviceLimitBlock } from "./deviceLimitPolicy";
import { loginRegistrationPolicy } from "./deviceLifecycle";

describe("owner replacement flow", () => {
  it("allows activation after owner frees a slot", () => {
    let activeCount = 3;
    const limit = 3;
    const gate = evaluateDeviceLimitBlock({
      deviceLimit: limit,
      activeCount,
      currentStatus: null,
    });
    expect(gate.blocked).toBe(true);
    activeCount -= 1;
    const after = evaluateDeviceLimitBlock({
      deviceLimit: limit,
      activeCount,
      currentStatus: null,
    });
    expect(after.blocked).toBe(false);
  });
});

describe("cashier blocked flow", () => {
  it("same limit gate applies regardless of role (UI differs)", () => {
    expect(
      evaluateDeviceLimitBlock({ deviceLimit: 3, activeCount: 3, currentStatus: null }).blocked,
    ).toBe(true);
  });
});

describe("existing active device bypass", () => {
  it("login policy touch_active when already active", () => {
    expect(loginRegistrationPolicy("active")).toBe("touch_active");
    expect(
      evaluateDeviceLimitBlock({ deviceLimit: 3, activeCount: 3, currentStatus: "active" }).blocked,
    ).toBe(false);
  });
});
