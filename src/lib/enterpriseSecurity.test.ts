import { describe, expect, it, beforeEach } from "vitest";
import {
  clearSecuritySession,
  createSecuritySession,
  isSecuritySessionActive,
  verifyShopSecurityPinSync,
  hashShopSecurityPin,
  verifyManagerApprovalPinSync,
  verifyBackOfficeShellCredentialSync,
} from "./enterpriseSecurity";
import { verifyOwnerPin, clearSensitiveActionSession } from "./sensitiveActionAuth";
import type { ShopPreferences } from "../types";
import { hashStaffSecret } from "./staffSecret";

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

describe("enterpriseSecurity", () => {
  beforeEach(() => {
    clearSecuritySession();
    clearSensitiveActionSession();
  });

  it("unified session covers scopes", () => {
    createSecuritySession({
      scopes: ["change_settings"],
      credential: "shop_security_pin",
      user: { role: "owner", actorUserId: "u1", actorLabel: "Owner" },
      deviceId: "d1",
      auditId: "a1",
    });
    expect(isSecuritySessionActive("change_settings")).toBe(true);
    expect(isSecuritySessionActive("back_office_shell")).toBe(false);
  });

  it("verifyOwnerPin delegates to manager approval (staff or shop legacy)", () => {
    expect(verifyOwnerPin("1234", { backOfficePin: "1234", staffAccounts: [] })).toBe(true);
    expect(verifyOwnerPin("9999", { backOfficePin: "1234", staffAccounts: [] })).toBe(false);
  });

  it("verifyManagerApprovalPinSync accepts legacy staff pin", () => {
    const p = prefs({
      staffAccounts: [
        {
          id: "m1",
          name: "Mgr",
          role: "manager",
          pin: "4321",
          active: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
    });
    expect(verifyManagerApprovalPinSync("4321", p)).toBe(true);
  });

  it("hashed shop PIN verifies async path", async () => {
    const hash = await hashShopSecurityPin("5678");
    expect(verifyShopSecurityPinSync("5678", hash)).toBe(false);
    const { verifyShopSecurityPinAsync } = await import("./enterpriseSecurity/shopPinSecret");
    expect(await verifyShopSecurityPinAsync("5678", hash)).toBe(true);
  });

  it("back office shell sync accepts fnv1a staff hash", () => {
    const p = prefs({
      staffAccounts: [
        {
          id: "m2",
          name: "Hash Mgr",
          role: "manager",
          pinHash: hashStaffSecret("4321"),
          active: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
    });
    const r = verifyBackOfficeShellCredentialSync("4321", p, { userId: "u", role: "manager", displayName: "M" });
    expect(r.ok).toBe(true);
  });
});
