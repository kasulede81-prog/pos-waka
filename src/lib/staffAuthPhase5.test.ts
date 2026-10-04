import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { usePosStore } from "../store/usePosStore";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { clearDeviceAuthorityCache } from "./deviceAuthority";
import type { StaffAccount, UserRole } from "../types";
import {
  renderStaffInviteEmail,
  staffInviteAcceptUrl,
} from "../../supabase/functions/_shared/email/staffInviteEmail";
import { completeStaffCredentialRecovery } from "./staffCredentialRecoveryOps";

/**
 * Phase 5 — the last of the four-credential model leaves the product, and the invitation gains the
 * one action it was missing.
 *
 * The rule this file exists to hold: ONLINE is Google, OFFLINE is the PIN, and nothing else is
 * offered as a way in. Existing records keep every legacy credential they already hold; there is
 * simply no longer a way to be issued a new one.
 */

vi.mock("./staffSyncQueue", () => ({
  createStaffInCloudFirst: vi.fn(async (row: { id: string }) => ({ ok: true as const, id: row.id })),
}));

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const RECOVERY_SETUP = read("src/components/auth/StaffRecoveryCredentialSetup.tsx");
const RESET_DIALOGS = read("src/components/auth/StaffCredentialResetDialog.tsx");
const RECOVERY_OPS = read("src/lib/staffCredentialRecoveryOps.ts");
const OFFLINE_AUTH = read("src/lib/staffOfflineAuth.ts");
const INVITE_CARD = read("src/components/staff/StaffCloudInviteCard.tsx");
const TEAM_LIST = read("src/components/staff/StaffTeamList.tsx");
const SQL_164 = read("supabase/migrations/164_staff_v2_invite_staff_id_or_client_id.sql");
const SQL_INVITE_GOOGLE = read("supabase/migrations/20261003030000_staff_invite_google_identity.sql");
const EMAIL_CONFIG = read("supabase/functions/_shared/email/config.ts");

function staff(partial: Partial<StaffAccount> & { id: string; name: string }): StaffAccount {
  return {
    role: "cashier",
    active: true,
    pinHash: "pin-hash",
    linkedAuthUserId: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...partial,
  };
}

// ===========================================================================
// 1 / 2 — no password creation or reset anywhere in the staff surfaces
// ===========================================================================

describe("no normal staff password management remains", () => {
  it("2 — StaffPasswordResetDialog no longer exists anywhere", () => {
    expect(existsSync(resolve(ROOT, "src/components/auth/StaffCredentialResetDialog.tsx"))).toBe(true);
    expect(RESET_DIALOGS).not.toMatch(/export function StaffPasswordResetDialog/);
    expect(RESET_DIALOGS).not.toMatch(/EnterprisePasswordField/);
    // …and nothing else in the product references it.
    for (const file of [
      "src/pages/StaffAccessPage.tsx",
      "src/components/staff/StaffTeamList.tsx",
      "src/components/staff/StaffCreateWizard.tsx",
      "src/components/staff/StaffCloudInviteCard.tsx",
    ]) {
      expect(read(file), `${file} must not reference the deleted dialog`).not.toMatch(
        /StaffPasswordResetDialog/,
      );
    }
    expect(read("src/features/staff/management/index.ts")).not.toMatch(/StaffPasswordResetDialog/);
  });

  it("2 — the PIN reset dialog is the only staff credential dialog left", () => {
    expect(RESET_DIALOGS).toMatch(/export function StaffPinResetDialog/);
  });

  it("1 — the recovery setup no longer offers a password", () => {
    expect(RECOVERY_SETUP).not.toMatch(/type="password"/);
    expect(RECOVERY_SETUP).not.toMatch(/staffCredentialRecoverySetupPassword|staffCredentialRecoveryPasswordOptional/);
    // It still refuses to submit without a PIN, which is why the password was never load-bearing.
    expect(RECOVERY_SETUP).toMatch(/if \(pin\.length < 4\)/);
  });

  it("1 — the recovery copy frames the PIN as a terminal credential, not a login", () => {
    expect(RECOVERY_SETUP).toMatch(/staffCredentialRecoveryPinNotLogin/);
  });

  it("1 — the backend still accepts a password, so nothing obsolete is left unreachable", () => {
    // Kept deliberately: `password?` remains on the operation for compatibility.
    expect(RECOVERY_OPS).toMatch(/password\?: string;/);
    expect(RECOVERY_OPS).toMatch(/if \(!pinNorm && !password\)/);
  });
});

// ===========================================================================
// 3 / 4 — Google online, PIN offline
// ===========================================================================

describe("the two access kinds are the only two", () => {
  it("3 — Google is the online staff identity", () => {
    expect(INVITE_CARD).toMatch(/staffInviteGoogleNote/);
    expect(SQL_INVITE_GOOGLE).toMatch(/auth_user_google_identity_email/);
    expect(SQL_INVITE_GOOGLE).toMatch(/google_identity_required/);
  });

  it("4 — the PIN is the offline credential and is still managed", () => {
    expect(TEAM_LIST).toMatch(/staffOfflineAccessTitle/);
    expect(TEAM_LIST).toMatch(/onResetPin/);
    expect(RECOVERY_SETUP).toMatch(/EnterprisePinPad/);
  });

  it("4 — the offline verifier is untouched, so existing PINs keep working", () => {
    expect(OFFLINE_AUTH).toMatch(/verifyStaffSecret|pinHash/);
  });
});

// ===========================================================================
// 7 / 8 / 9 — the invitation lifecycle, including resend
// ===========================================================================

describe("invitation lifecycle", () => {
  it("7 — re-inviting revokes the previous pending invitation BEFORE inserting the new one", () => {
    const revoke = SQL_164.indexOf("set revoked_at = now ()");
    const insert = SQL_164.indexOf("insert into public.shop_staff_invitations");
    expect(revoke).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(revoke);
    expect(SQL_164).toMatch(/and i\.accepted_at is null\s+and i\.revoked_at is null/);
  });

  it("8 — every invitation gets a fresh 256-bit token and a fresh expiry", () => {
    expect(SQL_164).toMatch(/encode \(gen_random_bytes \(32\), 'hex'\)/);
    expect(SQL_164).toMatch(/now \(\) \+ interval '7 days'/);
    // Only the hash is stored; the plaintext is returned once, for the email.
    expect(SQL_164).toMatch(/v_hash := public\.staff_v2_hash_invite_token \(v_token\)/);
  });

  it("7 — a revoked token is refused at acceptance", () => {
    expect(SQL_INVITE_GOOGLE).toMatch(/v_inv\.revoked_at is not null/);
    expect(SQL_INVITE_GOOGLE).toMatch(/'revoked'/);
  });

  it("resend reuses the SAME send path — no second, weaker code path", () => {
    expect(INVITE_CARD).toMatch(/const resend = async/);
    // Both the form and the resend call the one function.
    const sends = INVITE_CARD.match(/sendStaffInvite\(/g) ?? [];
    expect(sends.length).toBe(2);
    expect(INVITE_CARD).toMatch(/data-testid=\{`staff-invite-resend-\$\{invite\.id\}`\}/);
  });

  it("resend keeps the invited email, its role and its profile link", () => {
    const resendBody = INVITE_CARD.slice(INVITE_CARD.indexOf("const resend = async"));
    expect(resendBody.slice(0, 900)).toMatch(/email: invite\.email/);
    expect(resendBody.slice(0, 900)).toMatch(/posRole: invitePosRoleForStaff\(invite\.pos_role\)/);
    expect(resendBody.slice(0, 900)).toMatch(/staffId: invite\.staff_id/);
  });

  it("9 — acceptance still requires the invited Google email", () => {
    expect(SQL_INVITE_GOOGLE).toMatch(/v_inv\.email is distinct from v_email/);
    expect(SQL_INVITE_GOOGLE).toMatch(/v_google_email is distinct from v_email/);
  });

  it("revoking is confirmed before a link someone holds is killed", () => {
    expect(INVITE_CARD).toMatch(/staffInviteRevokeConfirm/);
    expect(INVITE_CARD).toMatch(/window\.confirm/);
  });
});

// ===========================================================================
// 5 / 6 — existing records keep everything they hold
// ===========================================================================

describe("existing staff records are not touched", () => {
  beforeEach(() => {
    clearDeviceAuthorityCache();
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
  });

  function seedLegacy(): StaffAccount {
    const legacy = staff({
      id: "legacy-1",
      name: "Legacy John",
      username: "legacy01",
      pinHash: "legacy-pin-hash",
      passwordHash: "legacy-password-hash",
      role: "cashier",
    });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      preferences: { ...usePosStore.getState().preferences, staffAccounts: [legacy] },
      auditLogs: [],
    });
    return legacy;
  }

  it("5 / 6 — a role change preserves the profile and every credential on it", () => {
    const legacy = seedLegacy();
    usePosStore.getState().updateStaffAccount(legacy.id, { role: "manager" as UserRole });

    const after = usePosStore.getState().preferences.staffAccounts?.find((s) => s.id === legacy.id);
    expect(after?.name).toBe("Legacy John");
    expect(after?.username).toBe("legacy01");
    expect(after?.pinHash).toBe("legacy-pin-hash");
    expect(after?.passwordHash).toBe("legacy-password-hash");
  });

  it("6 — the profile count never changes, so no duplicate profile is created", () => {
    seedLegacy();
    const before = usePosStore.getState().preferences.staffAccounts?.length;
    usePosStore.getState().updateStaffAccount("legacy-1", { role: "manager" as UserRole });
    expect(usePosStore.getState().preferences.staffAccounts?.length).toBe(before);
  });

  it("6 — recovery without a password keeps the PIN and does not crash on the missing argument", async () => {
    const legacy = staff({ id: "rec-1", name: "Recovery Ada", pinHash: null, passwordHash: null });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      preferences: { ...usePosStore.getState().preferences, staffAccounts: [legacy] },
      auditLogs: [],
    });

    // No password is passed at all — exactly what the dialog now does.
    const result = await completeStaffCredentialRecovery({ shopId: "shop-1", staffId: "rec-1", pin: "4321" });

    expect(result).toEqual({ ok: true });
    const after = usePosStore.getState().preferences.staffAccounts?.find((s) => s.id === "rec-1");
    expect(after?.pinHash).toBeTruthy();
    expect(after?.passwordHash).toBeNull();
  });

  it("6 — the operation still refuses when NEITHER credential is supplied", async () => {
    const legacy = staff({ id: "rec-2", name: "Recovery B", pinHash: null, passwordHash: null });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      preferences: { ...usePosStore.getState().preferences, staffAccounts: [legacy] },
      auditLogs: [],
    });

    await expect(completeStaffCredentialRecovery({ shopId: "shop-1", staffId: "rec-2" })).resolves.toEqual({
      ok: false,
      errorKey: "staffRecoveryCredentialRequired",
    });
  });
});

// ===========================================================================
// 10 / 11 / 12 — the invitation email
// ===========================================================================

describe("invitation email", () => {
  it("10 — the accept link is on pos.dkasu.com", () => {
    expect(staffInviteAcceptUrl("tok")).toBe("https://pos.dkasu.com/staff/accept?token=tok");
    expect(EMAIL_CONFIG).toMatch(/posUrl: "https:\/\/pos\.dkasu\.com"/);
  });

  it("11 — no WAKA host anywhere in the rendered invitation", () => {
    const mail = renderStaffInviteEmail({
      shopName: "Acme Duka",
      roleLabel: "cashier",
      acceptUrl: staffInviteAcceptUrl("tok-123"),
    });
    for (const part of [mail.subject, mail.html, mail.text]) {
      expect(part).not.toMatch(/waka\.ug/i);
    }
  });

  it("12 — the registered legal entity is still disclosed", () => {
    const mail = renderStaffInviteEmail({
      shopName: "Acme Duka",
      roleLabel: "cashier",
      acceptUrl: staffInviteAcceptUrl("tok-123"),
    });
    expect(mail.html).toContain("WAKA MARKETPLACE LIMITED");
  });

  it("the token is carried untouched — only the host changed", () => {
    const token = "a1b2c3d4e5f6".repeat(4);
    expect(staffInviteAcceptUrl(token)).toBe(
      `https://pos.dkasu.com/staff/accept?token=${encodeURIComponent(token)}`,
    );
  });
});
