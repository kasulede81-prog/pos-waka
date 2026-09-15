import { describe, expect, it, beforeEach } from "vitest";
import {
  UNLOCK_MAX_ATTEMPTS,
  clearUnlockFailures,
  getUnlockLockoutStatus,
  recordUnlockFailure,
  unlockLimiterScope,
} from "./staffLoginLimiter";
import {
  computeSessionExpiresAt,
  isStaffSessionExpired,
  resolveStaffAutoLockMinutes,
  resolveStaffMaxFailedAttempts,
  staffRememberSessionEnabled,
} from "./staffSession";
import type { ShopPreferences } from "../../types";

function prefs(extra?: Partial<ShopPreferences>): ShopPreferences {
  return {
    businessType: "kiosk_duka",
    staffRememberSession: true,
    staffSessionTimeoutMinutes: 60,
    staffAutoLockMinutes: 5,
    staffMaxFailedAttempts: 5,
    ...extra,
  } as ShopPreferences;
}

function installBrowserMocks(): void {
  const store: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
}

describe("staffLoginLimiter", () => {
  beforeEach(() => {
    installBrowserMocks();
    localStorage.clear();
  });

  it("locks progressively after repeated failures", () => {
    const scope = unlockLimiterScope("staff-1");
    for (let i = 0; i < UNLOCK_MAX_ATTEMPTS - 1; i += 1) {
      const r = recordUnlockFailure(scope);
      expect(r.lockedUntil).toBeNull();
    }
    const locked = recordUnlockFailure(scope);
    expect(locked.lockedUntil).toBeTruthy();
    expect(locked.waitSeconds).toBe(30);
    expect(getUnlockLockoutStatus(scope).locked).toBe(true);
  });

  it("clears failures after successful unlock", () => {
    const scope = unlockLimiterScope("staff-2");
    recordUnlockFailure(scope);
    clearUnlockFailures(scope);
    expect(getUnlockLockoutStatus(scope).failures).toBe(0);
  });
});

describe("staffSession", () => {
  beforeEach(() => {
    installBrowserMocks();
    localStorage.clear();
  });

  it("expires remembered sessions after timeout", () => {
    const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    localStorage.setItem("waka.staff.session.started.v1", startedAt);
    expect(isStaffSessionExpired(prefs({ staffSessionTimeoutMinutes: 60 }))).toBe(true);
  });

  it("computes expiry from preferences", () => {
    const startedAt = "2026-07-06T10:00:00.000Z";
    expect(computeSessionExpiresAt(prefs({ staffSessionTimeoutMinutes: 30 }), startedAt)).toBe(
      "2026-07-06T10:30:00.000Z",
    );
  });

  it("resolves security preference defaults", () => {
    expect(resolveStaffAutoLockMinutes(prefs())).toBe(5);
    expect(resolveStaffMaxFailedAttempts(prefs())).toBe(5);
    expect(staffRememberSessionEnabled(prefs({ staffRememberSession: false }))).toBe(false);
  });
});
