import { describe, expect, it } from "vitest";
import { resolveDayCloseApprovalAsync } from "./dayCloseApprovals";
import { hashShopSecurityPin } from "./enterpriseSecurity/shopPinSecret";
import type { ShopPreferences } from "../types";

function prefs(partial: Partial<ShopPreferences>): ShopPreferences {
  return {
    businessType: "kiosk_duka",
    kioskQuickSell: true,
    onboardingDone: true,
    schemaVersion: 2,
    staffAccounts: [],
    backOfficePin: null,
    ...partial,
  } as ShopPreferences;
}

describe("resolveDayCloseApprovalAsync", () => {
  it("accepts Argon2-hashed shop security PIN for sync override", async () => {
    const hash = await hashShopSecurityPin("5678");
    const p = prefs({ backOfficePin: hash });
    const result = await resolveDayCloseApprovalAsync(
      "sync_override",
      "5678",
      p,
      "owner",
      "owner-1",
      "Owner",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.via).toBe("shop_pin");
      expect(result.auth.role).toBe("owner");
    }
  });

  it("rejects wrong shop security PIN", async () => {
    const hash = await hashShopSecurityPin("5678");
    const p = prefs({ backOfficePin: hash });
    const result = await resolveDayCloseApprovalAsync(
      "sync_override",
      "9999",
      p,
      "owner",
      "owner-1",
      "Owner",
    );
    expect(result.ok).toBe(false);
  });
});
