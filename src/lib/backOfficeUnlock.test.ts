import { describe, expect, it } from "vitest";
import { hashStaffSecret } from "./staffSecret";
import { isBackOfficePinRequired, resolveBackOfficeUnlock } from "./backOfficeUnlock";
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

const ownerStaffHashOnly: StaffAccount = {
  id: "own-1",
  name: "Owner Hash",
  role: "owner",
  pinHash: hashStaffSecret("5678"),
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const managerHashOnly: StaffAccount = {
  id: "mgr-2",
  name: "Hash Manager",
  role: "manager",
  pinHash: hashStaffSecret("4321"),
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const managerPasswordHashOnly: StaffAccount = {
  id: "mgr-3",
  name: "Pwd Manager",
  role: "manager",
  passwordHash: hashStaffSecret("secret99"),
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("isBackOfficePinRequired", () => {
  it("requires PIN when shop backOfficePin is set", () => {
    expect(isBackOfficePinRequired(prefs({ backOfficePin: "1234" }))).toBe(true);
  });

  it("requires PIN when manager has hash-only secret (synced staff)", () => {
    expect(isBackOfficePinRequired(prefs({ staffAccounts: [managerHashOnly] }))).toBe(true);
  });

  it("does not require PIN when no shop PIN and no unlock secrets", () => {
    expect(isBackOfficePinRequired(prefs({ staffAccounts: [] }))).toBe(false);
  });
});

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

  it("manager hash-only PIN unlocks (synced / offline staff)", () => {
    const r = resolveBackOfficeUnlock("4321", prefs({ staffAccounts: [managerHashOnly] }), {
      userId: "auth:mgr",
      role: "manager",
      displayName: "Hash",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.via).toBe("staff_pin");
      expect(r.role).toBe("manager");
      expect(r.staffId).toBe("mgr-2");
    }
  });

  it("owner hash-only PIN unlocks", () => {
    const r = resolveBackOfficeUnlock("5678", prefs({ staffAccounts: [ownerStaffHashOnly] }), {
      userId: "auth:owner",
      role: "owner",
      displayName: "Owner",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.via).toBe("staff_pin");
      expect(r.role).toBe("owner");
      expect(r.actorLabel).toBe("Owner Hash");
    }
  });

  it("manager passwordHash unlock works", () => {
    const r = resolveBackOfficeUnlock("secret99", prefs({ staffAccounts: [managerPasswordHashOnly] }), {
      userId: "auth:mgr",
      role: "manager",
      displayName: "Pwd",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe("staff_pin");
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

  it("shop PIN fallback works when no staff match", () => {
    const r = resolveBackOfficeUnlock("8888", prefs({ backOfficePin: "8888", staffAccounts: [managerHashOnly] }), {
      userId: "auth:owner",
      role: "owner",
      displayName: "Owner",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe("shop_pin");
  });

  it("staff PIN takes precedence over shop PIN", () => {
    const r = resolveBackOfficeUnlock("4321", prefs({ backOfficePin: "4321", staffAccounts: [managerStaff] }), {
      userId: "auth:owner",
      role: "owner",
      displayName: "Owner",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe("staff_pin");
  });

  it("invalid PIN returns not ok", () => {
    const r = resolveBackOfficeUnlock("0000", prefs({ backOfficePin: "1234", staffAccounts: [managerStaff] }), {
      userId: "auth:owner",
      role: "owner",
    });
    expect(r.ok).toBe(false);
  });

  it("invalid PIN against hash-only staff returns not ok", () => {
    const r = resolveBackOfficeUnlock("0000", prefs({ staffAccounts: [managerHashOnly] }), {
      userId: "auth:mgr",
      role: "manager",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.via).toBe("staff_pin");
  });
});
