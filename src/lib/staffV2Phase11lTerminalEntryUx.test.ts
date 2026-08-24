import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { shouldShowEnterpriseStaffLockScreen } from "./lockPos";
import { authOperatorRole, resolveSessionActor } from "./sessionActor";

const ROOT = process.cwd();
const LOCK = readFileSync(resolve(ROOT, "src/components/auth/EnterpriseStaffLockScreen.tsx"), "utf8");
const APP_SHELL = readFileSync(resolve(ROOT, "src/components/layout/AppShell.tsx"), "utf8");
const LOGIN = readFileSync(resolve(ROOT, "src/pages/LoginPage.tsx"), "utf8");
const LOGOUT = readFileSync(resolve(ROOT, "src/lib/auth/enterpriseLogout.ts"), "utf8");
const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const CASHIER_UUID = "22222222-2222-4222-8222-222222222222";

describe("STAFF-V2 Phase 11l terminal lock entry clarity", () => {
  it("A — owner locked terminal shows EnterpriseStaffLockScreen", () => {
    expect(
      shouldShowEnterpriseStaffLockScreen({
        posLocked: true,
        authOperatorRole: "owner",
        hasPathSStaffSession: false,
        pathname: "/pos/sell",
        canManageShopSettings: true,
      }),
    ).toBe(true);
  });

  it("B — personal staff account never sees lock / SellerPicker path", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: CASHIER_UUID, email: "john@waka.invalid" } as never,
      email: "john@waka.invalid",
      shopMemberRole: "cashier",
      preferences: { posLocked: true, activeStaffId: null } as never,
    });
    expect(actor.authUserId).toBe(CASHIER_UUID);
    expect(actor.userId).toBe(CASHIER_UUID);
    expect(authOperatorRole(actor)).toBe("cashier");
    expect(
      shouldShowEnterpriseStaffLockScreen({
        posLocked: true,
        authOperatorRole: authOperatorRole(actor),
        hasPathSStaffSession: false,
        pathname: "/",
        canManageShopSettings: false,
      }),
    ).toBe(false);
    // Lock overlay (owner terminal) hosts SellerPicker — Path L must not render that shell.
    expect(APP_SHELL).toMatch(/shouldShowEnterpriseStaffLockScreen/);
  });

  it("C — Sign in with another account escapes via enterprise logout → /login", () => {
    expect(t("en", "enterpriseLockEmergencyLogout").toLowerCase()).toContain("another account");
    expect(LOCK).toMatch(/data-testid="lock-screen-sign-in-another-account"/);
    expect(LOCK).toMatch(/onEmergencyLogout/);
    expect(APP_SHELL).toMatch(/emergencyStaffLogout\(\)/);
    expect(APP_SHELL).toMatch(/logout\(\)/);
    expect(USE_AUTH).toMatch(/performEnterpriseLogout/);
    expect(LOGOUT).toMatch(/window\.location\.replace\("\/login"\)/);
    expect(LOGOUT).toMatch(/clearStaffAuth/);
    expect(LOGOUT).toMatch(/clearRememberedStaffDevice/);
    expect(LOGOUT).toMatch(/clearStaffSessionPersistence/);
    expect(LOGOUT).toMatch(/resetForSignOut/);
    expect(LOGOUT).toMatch(/clearPersistedSupabaseAuthTokens/);
  });

  it("D — LoginPage defaults to email/password, not staff PIN view", () => {
    expect(LOGIN).toMatch(/useState<"owner" \| "staff">\("owner"\)/);
    expect(LOGIN).not.toMatch(/useState<"owner" \| "staff">\("staff"\)/);
  });

  it("copy — lock screen is terminal unlock, not account login", () => {
    expect(t("en", "lockPosTitle").toLowerCase()).toBe("terminal locked");
    expect(t("en", "lockPosSubSeller").toLowerCase()).toContain("shop account");
    expect(t("en", "lockPosSubSeller").toLowerCase()).toContain("not email/password");
    expect(t("en", "enterpriseLockScreenTag").toLowerCase()).toContain("shared");
    expect(t("en", "enterpriseLockAccountEscapeHint").toLowerCase()).toContain("email and password");
    expect(LOCK).toMatch(/enterpriseLockAccountEscapeHint/);
    expect(LOCK).toMatch(/lockPosTitle/);

    const owner = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: {} as never,
    });
    expect(owner.authRole).toBe("owner");
    expect(owner.authUserId).toBe(OWNER_UUID);
  });
});
