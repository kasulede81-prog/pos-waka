import { describe, expect, it } from "vitest";
import type { StaffAccount } from "../types";
import {
  STAFF_LOCKOUT_MAX_ATTEMPTS,
  STAFF_SECURITY_WINDOW_MAX,
  applyLocalFailedLogin,
  applyLocalSuccessfulLogin,
} from "./staffLoginSecurity";
import { isStaffLoginLocked } from "./staffSecret";

function staff(extra?: Partial<StaffAccount>): StaffAccount {
  return {
    id: "s1",
    name: "Jane",
    role: "cashier",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    failedPinAttempts: 0,
    ...extra,
  };
}

describe("staffLoginSecurity offline lockout", () => {
  it("locks after consecutive failures", () => {
    let row = staff();
    for (let i = 0; i < STAFF_LOCKOUT_MAX_ATTEMPTS; i += 1) {
      row = applyLocalFailedLogin(row);
    }
    expect(isStaffLoginLocked(row)).toBe(true);
    expect(row.failedPinAttempts).toBe(STAFF_LOCKOUT_MAX_ATTEMPTS);
  });

  it("clears counters on successful login", () => {
    const locked = applyLocalFailedLogin(applyLocalFailedLogin(staff({ failedPinAttempts: 4 })));
    const { staff: next } = applyLocalSuccessfulLogin(locked, "device-b", "web");
    expect(next.failedPinAttempts).toBe(0);
    expect(next.lockedUntil).toBeNull();
    expect(next.lastDeviceFingerprint).toBe("device-b");
  });

  it("tracks 24h failure window", () => {
    let row = staff();
    for (let i = 0; i < STAFF_SECURITY_WINDOW_MAX; i += 1) {
      row = applyLocalFailedLogin(row);
    }
    expect(row.failuresInWindow).toBe(STAFF_SECURITY_WINDOW_MAX);
  });

  it("detects device change", () => {
    const base = staff({ lastDeviceFingerprint: "device-a" });
    const { deviceChanged, previousDeviceFingerprint } = applyLocalSuccessfulLogin(base, "device-b", "android");
    expect(deviceChanged).toBe(true);
    expect(previousDeviceFingerprint).toBe("device-a");
  });
});
