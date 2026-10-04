import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { usePosStore } from "../store/usePosStore";
import { staffAccessState } from "./staffAccessState";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { clearDeviceAuthorityCache } from "./deviceAuthority";
import type { StaffAccount, UserRole } from "../types";
import type { StaffInvitationRow } from "./staffInvite";
import {
  renderStaffInviteEmail,
  staffInviteAcceptUrl,
} from "../../supabase/functions/_shared/email/staffInviteEmail";

/**
 * Phase 4 — the Staff Center must present ONE identity model:
 *
 *   ONLINE  → the person's own Google account
 *   OFFLINE → a PIN, a device credential for a shared terminal
 *
 * A staff password and a "custom login ID" belonged to neither. They are gone from every surface
 * the owner touches, while the stored columns and the offline verifier that reads them are
 * deliberately untouched — existing records must keep working.
 *
 * No DOM test project exists in this repo, so rendering is asserted through the source of the
 * components, and every decision that CAN be exercised without a DOM is exercised for real.
 */

vi.mock("./staffSyncQueue", () => ({
  createStaffInCloudFirst: vi.fn(async (row: { id: string }) => ({ ok: true as const, id: row.id })),
}));

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const WIZARD = read("src/components/staff/StaffCreateWizard.tsx");
const TEAM_LIST = read("src/components/staff/StaffTeamList.tsx");
const INVITE_CARD = read("src/components/staff/StaffCloudInviteCard.tsx");
const ACCESS_PAGE = read("src/pages/StaffAccessPage.tsx");
const INVITE_EMAIL = read("supabase/functions/_shared/email/staffInviteEmail.ts");
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

function invite(partial: Partial<StaffInvitationRow>): StaffInvitationRow {
  return {
    id: "inv-1",
    email: "john@example.com",
    membership_role: "cashier",
    pos_role: "cashier",
    staff_id: null,
    expires_at: "2099-01-01T00:00:00.000Z",
    accepted_at: null,
    revoked_at: null,
    created_at: "2026-08-23T00:00:00.000Z",
    ...partial,
  };
}

// ===========================================================================
// 1 / 2 / 20 — the new-staff flow asks for nothing legacy
// ===========================================================================

describe("new-staff wizard asks only for what the model needs", () => {
  it("1 — does not ask for a password", () => {
    expect(WIZARD).not.toMatch(/EnterprisePasswordField|staffPasswordPh/);
  });

  it("2 — does not ask for a username or custom login ID", () => {
    expect(WIZARD).not.toMatch(/staffAdvancedUsername|advUsername|staffUsernamePh/);
  });

  it("still asks for the things that ARE required", () => {
    expect(WIZARD).toMatch(/staffNameLabel/);
    expect(WIZARD).toMatch(/staffRoleLabel/);
    expect(WIZARD).toMatch(/staffPinLabel/);
  });

  it("20 — no staff component creates a password or username", () => {
    for (const [name, src] of [
      ["StaffCreateWizard", WIZARD],
      ["StaffCloudInviteCard", INVITE_CARD],
      ["StaffAccessPage", ACCESS_PAGE],
    ] as const) {
      expect(src, `${name} must not create a staff password`).not.toMatch(
        /password:\s*(input|adv|password)/,
      );
      expect(src, `${name} must not create a username`).not.toMatch(/username:\s*input\.username/);
    }
    // …and the page no longer even offers to reset one.
    expect(ACCESS_PAGE).not.toMatch(/StaffPasswordResetDialog|resetPasswordStaffId/);
    expect(TEAM_LIST).not.toMatch(/onResetPassword|staffResetPassword/);
  });

  it("presents the PIN as offline / shared-terminal access, not as a login", () => {
    expect(WIZARD).toMatch(/staffOfflineAccessTitle/);
    expect(WIZARD).toMatch(/staffOfflineAccessSub/);
    expect(TEAM_LIST).toMatch(/staffOnlineAccessTitle/);
    expect(TEAM_LIST).toMatch(/staffOfflineAccessTitle/);
  });
});

// ===========================================================================
// 3 / 6 / 7 — the invitation itself is unchanged and still requires an email
// ===========================================================================

describe("invitation flow keeps its shape", () => {
  it("3 — the send is gated on a usable email address", () => {
    expect(INVITE_CARD).toMatch(/disabled=\{busy \|\| !email\.includes\("@"\)\}/);
    expect(INVITE_CARD).toMatch(/type="email"/);
  });

  it("6 / 7 — send and revoke still go through the existing, unchanged lib calls", () => {
    expect(INVITE_CARD).toMatch(/sendStaffInvite\(/);
    expect(INVITE_CARD).toMatch(/revokeStaffInvitation\(/);
    // The security model is untouched by this phase.
    expect(INVITE_CARD).not.toMatch(/shop_accept_staff_invite|token_hash|p_token/);
  });

  it("3 — labels its controls, so the form is not placeholder-only", () => {
    expect(INVITE_CARD).toMatch(/staffInviteEmailLabel/);
    expect(INVITE_CARD).toMatch(/staffInviteRoleLabel/);
    expect(INVITE_CARD).toMatch(/staffInviteProfileLabel/);
  });

  it("tells the invited person to use Google, not to create an account", () => {
    expect(INVITE_CARD).toMatch(/staffInviteGoogleNote/);
    expect(INVITE_EMAIL).toMatch(/continue with Google/i);
    expect(INVITE_EMAIL).not.toMatch(/Create or sign in with this email/);
  });
});

// ===========================================================================
// 4 / 5 / 9 / 10 — role, permissions and PIN management all survive
// ===========================================================================

describe("role, permissions and PIN management survive the cleanup", () => {
  it("4 — role selection is still offered, from the existing catalog", () => {
    expect(WIZARD).toMatch(/roleOptions/);
    expect(WIZARD).toMatch(/setRoleTemplateId/);
    expect(TEAM_LIST).toMatch(/onUpdateRoleTemplate/);
    expect(TEAM_LIST).toMatch(/onAssignCustomRole/);
  });

  it("5 — permissions are still surfaced", () => {
    expect(WIZARD).toMatch(/staffCanRecordCashExpenses|staffAllowCashierExpenses/);
    expect(ACCESS_PAGE).toMatch(/staffPermissionsTitle/);
  });

  it("9 / 10 — PIN set and reset remain, and are labelled by what they do", () => {
    expect(TEAM_LIST).toMatch(/onResetPin/);
    expect(TEAM_LIST).toMatch(/pinConfigured \? t\(lang, "staffResetPin"\) : t\(lang, "staffPinSet"\)/);
    expect(ACCESS_PAGE).toMatch(/StaffPinResetDialog/);
    // The PIN dialog is still the offline-credential dialog, untouched.
    expect(ACCESS_PAGE).toMatch(/resetStaffSecret\(resetPinStaffId, \{ pin, password: null \}\)/);
  });

  it("keeps the PIN out of the sign-in copy — it is a terminal credential", () => {
    expect(TEAM_LIST).toMatch(/staffPinOfflineNote/);
    expect(TEAM_LIST).not.toMatch(/Last PIN\/password change/);
  });
});

// ===========================================================================
// 13 / 14 / 15 — the displayed state, exercised directly
// ===========================================================================

describe("staffAccessState — what the Staff Center shows", () => {
  it("13 — a Google-linked staff member reads as linked", () => {
    const state = staffAccessState(
      staff({ id: "s1", name: "Mary", linkedAuthUserId: "22222222-2222-4222-8222-222222222222" }),
    );
    expect(state.googleLinked).toBe(true);
    expect(state.invitePending).toBe(false);
    expect(state.googleNotLinked).toBe(false);
  });

  it("14 — a pending invitation reads as pending, not as linked and not as 'no account'", () => {
    const row = staff({ id: "s1", name: "Mary", email: "mary@example.com" });
    const state = staffAccessState(row, [invite({ staff_id: "s1", email: "mary@example.com" })]);
    expect(state.invitePending).toBe(true);
    expect(state.googleLinked).toBe(false);
    expect(state.googleNotLinked).toBe(false);
  });

  it("14 — a REVOKED invitation is not an active invitation", () => {
    const row = staff({ id: "s1", name: "Mary", email: "mary@example.com" });
    const state = staffAccessState(row, [
      invite({ staff_id: "s1", email: "mary@example.com", revoked_at: "2026-08-24T00:00:00.000Z" }),
    ]);
    expect(state.invitePending).toBe(false);
    expect(state.googleNotLinked).toBe(true);
  });

  it("15 — an inactive staff member is not shown as able to sign in", () => {
    const state = staffAccessState(
      staff({ id: "s1", name: "Mary", active: false, linkedAuthUserId: "22222222-2222-4222-8222-222222222222" }),
    );
    expect(state.active).toBe(false);
    // The disabled flag is the component's own badge; link state stays truthful.
    expect(state.googleLinked).toBe(true);
  });

  it("reports whether an offline credential exists", () => {
    expect(staffAccessState(staff({ id: "s1", name: "A", pinHash: "h" })).pinConfigured).toBe(true);
    expect(staffAccessState(staff({ id: "s1", name: "A", pinHash: null })).pinConfigured).toBe(false);
  });

  it("an unlinked profile with no invitation reads as having no Google account", () => {
    const state = staffAccessState(staff({ id: "s1", name: "A" }));
    expect(state.googleNotLinked).toBe(true);
    expect(state.googleLinked).toBe(false);
    expect(state.invitePending).toBe(false);
  });
});

// ===========================================================================
// 11 / 12 — existing staff records keep their legacy credentials
// ===========================================================================

describe("existing staff with legacy credentials keep working", () => {
  /**
   * The store gates every staff mutation on an authorised owner actor, so an owner session is set
   * up here — otherwise the assertion would pass for the wrong reason (the mutation would be
   * refused rather than preserving anything).
   */
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
    });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      preferences: { ...usePosStore.getState().preferences, staffAccounts: [legacy] },
      auditLogs: [],
    });
    return legacy;
  }

  it("11 — loads, and its role can still be changed", () => {
    const legacy = seedLegacy();
    usePosStore.getState().updateStaffAccount(legacy.id, { role: "manager" as UserRole });

    const after = usePosStore.getState().preferences.staffAccounts?.find((s) => s.id === legacy.id);
    expect(after?.role).toBe("manager");
  });

  it("12 — a role change does NOT delete the stored username or password hash", () => {
    const legacy = seedLegacy();
    usePosStore.getState().updateStaffAccount(legacy.id, { role: "manager" as UserRole });

    const after = usePosStore.getState().preferences.staffAccounts?.find((s) => s.id === legacy.id);
    expect(after?.username).toBe("legacy01");
    expect(after?.passwordHash).toBe("legacy-password-hash");
    expect(after?.pinHash).toBe("legacy-pin-hash");
  });

  it("12 — deactivating a staff member does not touch their credentials either", () => {
    const legacy = seedLegacy();
    usePosStore.getState().updateStaffAccount(legacy.id, { active: false });

    const after = usePosStore.getState().preferences.staffAccounts?.find((s) => s.id === legacy.id);
    expect(after?.active).toBe(false);
    expect(after?.username).toBe("legacy01");
    expect(after?.passwordHash).toBe("legacy-password-hash");
  });

  it("12 — the offline verifier still reads the legacy password, so nothing was silently broken", () => {
    const offlineAuth = read("src/lib/staffOfflineAuth.ts");
    expect(offlineAuth).toMatch(/passwordHash/);
    expect(offlineAuth).toMatch(/identifierMatches/);
  });
});

// ===========================================================================
// 19 — the invitation link points at the canonical DKASU host
// ===========================================================================

describe("19 — invitation email host", () => {
  it("builds the accept URL on pos.dkasu.com, not pos.waka.ug", () => {
    const url = staffInviteAcceptUrl("tok-123");
    expect(url).toBe("https://pos.dkasu.com/staff/accept?token=tok-123");
    expect(url).not.toContain("pos.waka.ug");
  });

  it("percent-encodes the token rather than pasting it into the URL", () => {
    expect(staffInviteAcceptUrl("a b/c")).toContain("token=a%20b%2Fc");
  });

  it("no user-facing WAKA host remains in the email brand", () => {
    expect(EMAIL_CONFIG).not.toMatch(/https:\/\/pos\.waka\.ug/);
    expect(EMAIL_CONFIG).not.toMatch(/https:\/\/waka\.ug/);
  });

  it("the RENDERED staff email carries no WAKA branding or WAKA host", () => {
    // Asserted on the OUTPUT, not the source: `WAKA_EMAIL_BRAND` is an internal identifier the
    // migration rules say to keep, so matching on it would forbid a name rather than a brand.
    const mail = renderStaffInviteEmail({
      shopName: "Acme Duka",
      roleLabel: "cashier",
      acceptUrl: staffInviteAcceptUrl("tok-123"),
    });

    // Two WAKA strings are legitimate and must stay:
    //   * `WAKA MARKETPLACE LIMITED` — the registered legal entity, which config/company.ts
    //     requires to keep matching the paperwork.
    //   * `waka-logo.png` — an asset FILENAME, i.e. a technical identifier the migration rules say
    //     to preserve. It is not shown to anyone; only the image it points at is.
    const withoutLegalEntity = mail.html
      .replaceAll("WAKA MARKETPLACE LIMITED", "")
      .replaceAll("waka-logo.png", "");
    expect(withoutLegalEntity).not.toMatch(/WAKA/i);

    // No legacy host anywhere, in any part of the message.
    for (const part of [mail.subject, mail.html, mail.text]) {
      expect(part).not.toMatch(/waka\.ug/i);
    }
    expect(mail.subject).not.toMatch(/WAKA/i);
    expect(mail.text).not.toMatch(/WAKA/i);

    expect(mail.subject).toContain("DKASU POS");
    expect(mail.html).toContain("https://pos.dkasu.com/staff/accept?token=tok-123");
    // The legal entity is still disclosed, as it must be.
    expect(mail.html).toContain("WAKA MARKETPLACE LIMITED");
  });
});
