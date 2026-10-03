import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";

const ROOT = process.cwd();
const LOGIN = readFileSync(resolve(ROOT, "src/pages/LoginPage.tsx"), "utf8");
const PIN_PANEL = readFileSync(resolve(ROOT, "src/components/auth/EnterpriseStaffLoginPanel.tsx"), "utf8");
const STAFF_ACCEPT = readFileSync(resolve(ROOT, "src/pages/StaffAcceptPage.tsx"), "utf8");
const LOCK = readFileSync(resolve(ROOT, "src/components/auth/EnterpriseStaffLockScreen.tsx"), "utf8");
const APP_SHELL = readFileSync(resolve(ROOT, "src/components/layout/AppShell.tsx"), "utf8");

describe("STAFF-V2 Phase 11f authentication terminology", () => {
  it("U1 — login page frames email/password as account login, not PIN", () => {
    expect(t("en", "loginOwnerHint").toLowerCase()).toContain("email and password");
    expect(t("en", "loginWelcomeSub").toLowerCase()).toContain("dkasu pos workspace");
    expect(t("en", "loginStaffPinHint").toLowerCase()).toContain("not your account login");
    expect(LOGIN).toMatch(/loginOwnerHint/);
    expect(LOGIN).toMatch(/loginStaffPinHint/);
    expect(t("en", "loginStaffPinEntry").toLowerCase()).not.toMatch(/staff sign in/);
  });

  it("U2 — PIN page uses choose-seller framing", () => {
    expect(t("en", "staffLoginTitle").toLowerCase()).toContain("choose seller");
    expect(t("en", "staffLoginSub").toLowerCase()).toContain("shared terminal");
    expect(t("en", "staffLoginSub").toLowerCase()).toContain("email/password");
    expect(PIN_PANEL).toMatch(/staffLoginTitle/);
    expect(PIN_PANEL).toMatch(/staffLoginSub/);
    expect(t("en", "staffLoginSubmit").toLowerCase()).toContain("continue selling");
  });

  it("U3 — PIN page does not say staff sign in", () => {
    expect(t("en", "staffLoginTitle").toLowerCase()).not.toContain("staff sign in");
    expect(t("en", "staffLoginSub").toLowerCase()).not.toContain("staff sign in");
    expect(t("en", "staffLoginSubmit").toLowerCase()).not.toBe("sign in");
    expect(PIN_PANEL).not.toMatch(/Staff sign in/);
  });

  it("U4 — owner registration CTA says create a new shop", () => {
    expect(t("en", "loginCreateNewAccount")).toBe("Create a new shop");
    expect(t("en", "loginRegisterShopHint").toLowerCase()).toContain("business owners");
    expect(LOGIN).toMatch(/to="\/register"/);
    expect(LOGIN).toMatch(/loginRegisterShopHint/);
  });

  /**
   * Phase 5 switched invitation acceptance to Google. The distinction this test
   * guards — cloud identity versus the shared-terminal PIN — still matters, so it
   * is asserted against the Google-first copy instead of the removed
   * email/password wording.
   */
  it("U5 — invite page distinguishes Google cloud identity from shared-terminal PIN", () => {
    expect(STAFF_ACCEPT).toMatch(/staffInviteAcceptSub/);
    expect(STAFF_ACCEPT).toMatch(/staffInviteGooglePinNote/);
    expect(t("en", "staffInviteAcceptSub").toLowerCase()).toContain("google");
    expect(t("en", "staffInviteGooglePinNote").toLowerCase()).toContain("pin");
    expect(t("en", "staffInviteGooglePinNote").toLowerCase()).toContain("shared terminal");
    // The password model is gone from this page.
    expect(t("en", "staffInviteGooglePinNote").toLowerCase()).not.toContain("email and password");
    expect(STAFF_ACCEPT).not.toMatch(/type="password"/);
  });

  it("seller-switch menus use choose seller, not switch user", () => {
    expect(t("en", "switchUser").toLowerCase()).toContain("choose seller");
    expect(t("en", "switchSeller").toLowerCase()).toContain("choose seller");
    expect(t("en", "userMenuSwitchUser").toLowerCase()).toContain("choose seller");
    expect(LOCK).toMatch(/switchSeller/);
    expect(APP_SHELL).toMatch(/userMenuSwitchUser/);
  });

  it("PIN field labels are seller-oriented", () => {
    expect(t("en", "staffLoginBusinessName").toLowerCase()).toBe("shop");
    expect(t("en", "staffLoginName").toLowerCase()).toContain("seller");
    expect(t("en", "staffLoginPin").toLowerCase()).toContain("seller pin");
  });
});
