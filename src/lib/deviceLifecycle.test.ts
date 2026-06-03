import { describe, expect, it } from "vitest";
import {
  heartbeatPolicy,
  isActiveDeviceStatus,
  loginRegistrationPolicy,
  normalizeShopDeviceStatus,
} from "./deviceLifecycle";

describe("normalizeShopDeviceStatus", () => {
  it("defaults unknown to active", () => {
    expect(normalizeShopDeviceStatus("ACTIVE")).toBe("active");
    expect(normalizeShopDeviceStatus(null)).toBe("active");
  });
});

describe("heartbeatPolicy", () => {
  it("accepts new and active devices", () => {
    expect(heartbeatPolicy(null)).toBe("accept");
    expect(heartbeatPolicy("active")).toBe("accept");
  });

  it("rejects disconnected and revoked (survives heartbeat)", () => {
    expect(heartbeatPolicy("disconnected")).toBe("reject");
    expect(heartbeatPolicy("revoked")).toBe("reject");
  });
});

describe("loginRegistrationPolicy", () => {
  it("reactivates disconnected on login", () => {
    expect(loginRegistrationPolicy("disconnected")).toBe("reactivate");
  });

  it("rejects revoked on login", () => {
    expect(loginRegistrationPolicy("revoked")).toBe("reject_revoked");
  });

  it("inserts new devices", () => {
    expect(loginRegistrationPolicy(null)).toBe("insert");
  });

  it("touches active without reactivation semantics", () => {
    expect(loginRegistrationPolicy("active")).toBe("touch_active");
  });
});

describe("isActiveDeviceStatus", () => {
  it("counts usage for active only", () => {
    expect(isActiveDeviceStatus("active")).toBe(true);
    expect(isActiveDeviceStatus("disconnected")).toBe(false);
  });
});
