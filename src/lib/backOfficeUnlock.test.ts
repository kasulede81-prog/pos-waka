import { describe, expect, it } from "vitest";
import { resolveBackOfficeUnlock } from "./backOfficeUnlock";
import type { ShopPreferences, StaffAccount } from "../types";

function prefs(partial: Partial<ShopPreferences>): ShopPreferences {
  return {
    businessType: "kiosk_duka",
    kioskQuickSell: true,
    onboardingDone: true,
    schemaVersion: 2,
    staffAccounts: partial.staffAccounts ?? [],
    backOfficePin: partial.backOfficePin ?? null,
    ...partial,
  } as ShopPreferences;
}

const managerStaff: StaffAccount = {
  id: "mgr-1",
  name: "Jane Manager",
  role: "manager",
  pin: "4321",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("resolveBackOfficeUnlock", () => {
  it("manager staff PIN unlocks without shop PIN", () => {
    const r = resolveBackOfficeUnlock("4321", prefs({ backOfficePin: "999999", staffAccounts: [managerStaff] }), {
      userId: "auth:mgr",
      role: "manager",
      displayName: "Jane",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.via).toBe("staff_pin");
      expect(r.role).toBe("manager");
      expect(r.actorLabel).toBe("Jane Manager");
    }
  });

  it("owner shop PIN still works when staff PIN does not match", () => {
    const r = resolveBackOfficeUnlock("1234", prefs({ backOfficePin: "1234", staffAccounts: [managerStaff] }), {
      userId: "auth:owner",
      role: "owner",
      displayName: "Owner",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.via).toBe("shop_pin");
      expect(r.role).toBe("owner");
    }
  });

  it("failed PIN returns not ok", () => {
    const r = resolveBackOfficeUnlock("0000", prefs({ backOfficePin: "1234", staffAccounts: [managerStaff] }), {
      userId: "auth:owner",
      role: "owner",
    });
    expect(r.ok).toBe(false);
  });
});
