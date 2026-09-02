import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setActiveAccountKey } from "../offline/accountScope";
import { resetActiveShopForTests, setActiveShopId } from "../offline/shopScope";
import {
  authorizePreferencesPatch,
} from "./settingsAuthorization";
import {
  clearSensitiveActionSession,
  grantSensitiveActionSession,
  isSensitiveActionGateSatisfied,
  isSensitiveActionSessionActive,
} from "./sensitiveActionAuth";
import {
  clearSecuritySession,
  createSecuritySession,
  grantSecuritySessionForResult,
  isSecuritySessionActive,
} from "./enterpriseSecurity";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import type { SessionActor } from "./sessionActor";

const ACCOUNT_A = "sb:user-a";
const ACCOUNT_B = "sb:user-b";
const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function actor(role: SessionActor["role"], userId = "user-a"): SessionActor {
  return { userId, role, displayName: "Test" };
}

function readSrc(relativeFromLib: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromLib), "utf8");
}

describe("SETTINGS-P1 security gate", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    resetActiveShopForTests();
    setActiveAccountKey(ACCOUNT_A);
    clearSensitiveActionSession();
    clearSecuritySession();
  });

  afterEach(() => {
    clearSensitiveActionSession();
    resetActiveShopForTests();
    setActiveAccountKey(null);
  });

  it("T1 — protected action requires a satisfied gate when biometric is on", () => {
    expect(
      isSensitiveActionGateSatisfied("change_settings", { biometricAuthEnabled: true }),
    ).toBe(false);
    expect(isSensitiveActionSessionActive()).toBe(false);
  });

  it("T2 — successful verification permits the intended action", () => {
    grantSensitiveActionSession();
    expect(
      isSensitiveActionGateSatisfied("change_settings", { biometricAuthEnabled: true }),
    ).toBe(true);
    expect(isSecuritySessionActive("change_settings")).toBe(true);
  });

  it("T3 — failed verification does not mark the gate as verified", () => {
    grantSecuritySessionForResult(
      { ok: false, reason: "invalid_credential", auditId: "denied" },
      ["change_settings"],
      "device-1",
    );
    expect(isSensitiveActionSessionActive()).toBe(false);
    expect(
      isSensitiveActionGateSatisfied("change_settings", { biometricAuthEnabled: true }),
    ).toBe(false);
  });

  it("T4 — cancel remains locked (finish(false) does not grant)", () => {
    const ctx = readSrc("../context/SensitiveActionAuthContext.tsx");
    expect(ctx).toContain("finish(false)");
    expect(ctx).toMatch(/const cancel = useCallback\(\(\) => \{\s*finish\(false\);/);
    expect(
      isSensitiveActionGateSatisfied("change_settings", { biometricAuthEnabled: true }),
    ).toBe(false);
  });

  it("T5 — direct preference mutation still requires role authorization", () => {
    grantSensitiveActionSession();
    expect(authorizePreferencesPatch(actor("cashier"), { shopDisplayName: "Hacked" }).ok).toBe(false);
    expect(authorizePreferencesPatch(actor("owner"), { shopDisplayName: "Ok" }).ok).toBe(true);
  });

  it("T6 — logout / null account cannot keep a prior verification", () => {
    grantSensitiveActionSession();
    expect(isSensitiveActionSessionActive()).toBe(true);
    setActiveAccountKey(null);
    expect(isSensitiveActionSessionActive()).toBe(false);
  });

  it("T7 — verification for account A cannot authorize account B", () => {
    grantSensitiveActionSession();
    expect(isSensitiveActionSessionActive()).toBe(true);
    setActiveAccountKey(ACCOUNT_B);
    expect(isSensitiveActionSessionActive()).toBe(false);
    expect(
      isSensitiveActionGateSatisfied("change_settings", { biometricAuthEnabled: true }),
    ).toBe(false);
  });

  it("T8 — gate is account-level: shop A → B keeps the same account verification", () => {
    setActiveShopId(SHOP_A);
    createSecuritySession({
      scopes: ["change_settings"],
      credential: "shop_security_pin",
      user: { role: "owner", actorUserId: "user-a", actorLabel: "Owner" },
      deviceId: "d1",
      auditId: "a1",
    });
    expect(isSecuritySessionActive("change_settings")).toBe(true);
    setActiveShopId(SHOP_B);
    expect(isSecuritySessionActive("change_settings")).toBe(true);
    expect(setActiveAccountKey(ACCOUNT_A)).toBe(false);
  });

  it("T9 — harmless Settings remain usable when the biometric gate is off", () => {
    expect(
      isSensitiveActionGateSatisfied("change_settings", { biometricAuthEnabled: false }),
    ).toBe(true);
    const app = readSrc("../App.tsx");
    const hubIdx = app.indexOf("<SettingsHubPage");
    expect(hubIdx).toBeGreaterThan(-1);
    expect(app.slice(Math.max(0, hubIdx - 280), hubIdx)).not.toContain("SettingsChangeGate");
    const appearance = app.slice(
      app.indexOf('path="settings/appearance"'),
      app.indexOf('path="settings/notifications"'),
    );
    expect(appearance).not.toContain("SettingsChangeGate");
  });

  it("T10 — passing the security session does not bypass role permission", () => {
    grantSensitiveActionSession();
    expect(authorizePreferencesPatch(actor("cashier"), { backOfficePin: "1234" }).ok).toBe(false);
    expect(authorizePreferencesPatch(actor("manager"), { biometricAuthEnabled: true }).ok).toBe(false);
  });

  it("T11 — failed PIN grant path never leaves a success session", () => {
    const ctx = readSrc("../context/SensitiveActionAuthContext.tsx");
    expect(ctx).toMatch(
      /if \(!verified\.ok\) \{[\s\S]*?enterpriseSecurityWrongPin[\s\S]*?return;[\s\S]*?grantForKind\(pending\.kind\)/,
    );
    expect(isSensitiveActionSessionActive()).toBe(false);
  });

  it("T12 — owner deletion still requires recent reauth at the mutation", () => {
    const deletion = readSrc("./ownerAccountDeletion.ts");
    expect(deletion).toContain("assertRecentOwnerDeleteReauth");
    expect(deletion).toContain('errorCode: "reauth_required"');
    const page = readSrc("../pages/AccountDeletionPage.tsx");
    expect(page).toContain("reauthenticateOwnerWithPassword");
    expect(page).toContain("reauthenticateOwnerWithGoogle");
  });
});
