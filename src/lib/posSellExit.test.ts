import { describe, expect, it } from "vitest";
import { shouldLockAfterSellExit } from "./posSellExit";
import type { ShopPreferences } from "../types";

function prefs(extra?: Partial<ShopPreferences>): ShopPreferences {
  return {
    businessType: "kiosk_duka",
    backOfficePin: "1234",
    staffAutoLockMinutes: 5,
    staffRequirePinAfterIdle: true,
    staffAccounts: [],
    ...extra,
  } as ShopPreferences;
}

describe("shouldLockAfterSellExit", () => {
  it("locks when auto-lock is on and a PIN exists", () => {
    expect(shouldLockAfterSellExit(prefs())).toBe(true);
  });

  it("does not lock when Auto-lock is Never", () => {
    expect(shouldLockAfterSellExit(prefs({ staffAutoLockMinutes: 0 }))).toBe(false);
  });

  it("does not lock when Require PIN after idle is off", () => {
    expect(shouldLockAfterSellExit(prefs({ staffRequirePinAfterIdle: false }))).toBe(false);
  });
});
