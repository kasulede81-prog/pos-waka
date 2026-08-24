import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { staffAcceptLoginHref, staffAcceptReturnPath } from "./staffInvite";

const ROOT = process.cwd();
const LOGIN = readFileSync(resolve(ROOT, "src/pages/LoginPage.tsx"), "utf8");
const STAFF_ACCEPT = readFileSync(resolve(ROOT, "src/pages/StaffAcceptPage.tsx"), "utf8");
const REGISTER = readFileSync(resolve(ROOT, "src/pages/RegisterPage.tsx"), "utf8");
const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");
const SESSION_ACTOR = readFileSync(resolve(ROOT, "src/lib/sessionActor.ts"), "utf8");

/** Synthetic invite token for path-preservation tests only — never a real invite. */
const SYNTHETIC_TOKEN = "phase11e.test.token.not-real";

describe("STAFF-V2 Phase 11e authentication UX clarification", () => {
  it("U1 — neutral login framing for owners and invited staff", () => {
    expect(t("en", "loginWelcomeSub")).toBe("Sign in to your WAKA POS workspace");
    expect(t("en", "loginWelcomeSub").toLowerCase()).not.toContain("owner access");
    expect(t("en", "loginOwnerHint").toLowerCase()).toContain("invited staff");
    expect(t("en", "loginOwnerHint").toLowerCase()).toContain("email");
    expect(t("en", "loginOwnerHint").toLowerCase()).toContain("password");
    expect(LOGIN).toMatch(/loginWelcomeSub/);
    expect(LOGIN).toMatch(/loginOwnerHint/);
  });

  it("U2 — registration CTA is owner/business setup, not staff signup", () => {
    expect(t("en", "loginCreateNewAccount")).toBe("Create a new shop");
    expect(t("en", "loginCreateNewAccount").toLowerCase()).not.toBe("create account");
    expect(LOGIN).toMatch(/to="\/register"/);
    expect(LOGIN).toMatch(/loginCreateNewAccount/);
    expect(LOGIN).toMatch(/data-testid="login-register-shop"/);
    expect(APP).toMatch(/path="\/register"/);
    expect(REGISTER).toMatch(/signUpQuick/);
    expect(REGISTER).toMatch(/shopName/);
    expect(REGISTER).toMatch(/ownerName/);
  });

  it("U3 — returning invited staff use the normal email/password login contract", () => {
    expect(LOGIN).toMatch(/onLogin\(email, password\)/);
    expect(APP).toMatch(/onLogin=\{auth\.signIn\}/);
    expect(USE_AUTH).toMatch(/signInWithPassword/);
    expect(USE_AUTH).toMatch(/const signIn = useCallback/);
    // Independent Auth staff keep UUID identity (not staff:<id>) on email login.
    expect(SESSION_ACTOR).toMatch(/authUserId: baseUserId/);
    expect(USE_AUTH).toMatch(/hydrateStaffAuthWorkspace/);
  });

  it("U4 — shared terminal PIN is clearly separate from personal account login", () => {
    expect(t("en", "loginStaffPinEntry").toLowerCase()).toContain("shared terminal");
    expect(t("en", "loginStaffPinHint").toLowerCase()).toContain("different");
    expect(t("en", "loginStaffPinHint").toLowerCase()).toContain("email");
    expect(LOGIN).toMatch(/loginStaffPinEntry/);
    expect(LOGIN).toMatch(/loginStaffPinHint/);
    expect(LOGIN).toMatch(/data-testid="login-shared-terminal-pin"/);
    expect(LOGIN).toMatch(/setView\("staff"\)/);
    expect(LOGIN).toMatch(/onStaffLogin/);
    expect(USE_AUTH).toMatch(/const signInStaff = useCallback/);
  });

  it("U5 — invite-aware login shows invitation context", () => {
    expect(t("en", "loginInviteContext").toLowerCase()).toContain("invited");
    expect(LOGIN).toMatch(/loginInviteContext/);
    expect(LOGIN).toMatch(/data-testid="login-invite-context"/);
    expect(LOGIN).toMatch(/inviteLoginContext/);
    expect(LOGIN).toMatch(/staffAcceptReturnPath/);
  });

  it("U6 — staff accept return path with query token is preserved (synthetic token only)", () => {
    const href = staffAcceptLoginHref(SYNTHETIC_TOKEN);
    expect(href.startsWith("/login?next=")).toBe(true);
    const nextEncoded = href.slice("/login?next=".length);
    const next = decodeURIComponent(nextEncoded);
    expect(next).toBe(`/staff/accept?token=${encodeURIComponent(SYNTHETIC_TOKEN)}`);
    expect(staffAcceptReturnPath(next)).toBe(`/staff/accept?token=${encodeURIComponent(SYNTHETIC_TOKEN)}`);
    // Nested encode as URLSearchParams would produce after a round-trip through the browser.
    const asParam = new URLSearchParams({ next }).get("next");
    expect(staffAcceptReturnPath(asParam)).toBe(`/staff/accept?token=${encodeURIComponent(SYNTHETIC_TOKEN)}`);
    expect(LOGIN).not.toMatch(/reportAuthIssue\([\s\S]*token/);
    expect(LOGIN).not.toMatch(/console\.(log|debug|info).*token/);
  });

  it("U7 — ordinary login does not show invitation UI without staff-accept next", () => {
    expect(staffAcceptReturnPath(null)).toBeNull();
    expect(staffAcceptReturnPath("/")).toBeNull();
    expect(staffAcceptReturnPath("/onboarding")).toBeNull();
    expect(staffAcceptReturnPath("/staff/accept")).toBe("/staff/accept");
    // Invite banner and secondary CTAs are gated on inviteLoginContext.
    expect(LOGIN).toMatch(/inviteLoginContext \? \(/);
    expect(LOGIN).toMatch(/!inviteLoginContext \? \(/);
  });

  it("U8 — /register remains owner business registration", () => {
    expect(REGISTER).toMatch(/registerQuickTitle|Open your shop|shopName/);
    expect(REGISTER).toMatch(/signUpQuick/);
    expect(REGISTER).not.toMatch(/staff_invite/);
    expect(REGISTER).not.toMatch(/acceptStaffInviteToken/);
    expect(APP).toMatch(/path="\/register"[\s\S]*RegisterPage/);
  });

  it("StaffAccept copy clarifies existing vs new account and future email login", () => {
    expect(STAFF_ACCEPT).toMatch(/staffInviteLoginHelp/);
    expect(STAFF_ACCEPT).toMatch(/staffInviteSignupHelp/);
    expect(STAFF_ACCEPT).toMatch(/staffInviteFutureLoginNote/);
    expect(t("en", "staffInviteLoginHelp").toLowerCase()).toContain("already have");
    expect(t("en", "staffInviteSignupHelp").toLowerCase()).toContain("create your account");
    expect(t("en", "staffInviteFutureLoginNote").toLowerCase()).toContain("same email and password");
    expect(t("en", "staffInviteFutureLoginNote").toLowerCase()).toContain("not the shared terminal pin");
    // V3 state machine markers must remain.
    expect(STAFF_ACCEPT).toMatch(/shouldStartStaffInviteAccept/);
    expect(STAFF_ACCEPT).toMatch(/createStaffInviteAcceptAttemptController/);
    expect(STAFF_ACCEPT).toMatch(/runStaffInviteAcceptFlow/);
    expect(STAFF_ACCEPT).not.toMatch(/\[initializing, isAuthenticated, token, phase\]/);
  });
});
