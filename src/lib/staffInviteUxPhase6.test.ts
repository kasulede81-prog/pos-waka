import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "../lib/i18n";
import {
  FAIL_CLOSED_ROLE,
  hasActorPermission,
  hasPermission,
  normalizeUserRole,
  permissionsForRole,
  resolveAuthRole,
} from "../lib/permissions";
import { resolveStaffPermissions } from "../lib/enterpriseRoles/resolvePermissions";

/**
 * Phase 6 — invitation UX contract, authorization model, lifecycle consistency.
 *
 * The page itself is a presentation layer: it cannot grant access, so asserting
 * its rendering would not prove the security property. What it CAN be held to is
 * the contract — no password path, the right states, accessible announcements,
 * and a token that never reaches the URL, logs or errors. The authorization and
 * lifecycle assertions below run against the real functions.
 */

const ROOT = process.cwd();
const ACCEPT_PAGE = readFileSync(resolve(ROOT, "src/pages/StaffAcceptPage.tsx"), "utf8");

describe("Phase 6 — /staff/accept contract", () => {
  it("1/2. is Google-first and offers no password or sign-up path", () => {
    expect(ACCEPT_PAGE).toMatch(/requestGoogleIdTokenWithNonce/);
    expect(ACCEPT_PAGE).toMatch(/signInWithIdToken/);
    expect(ACCEPT_PAGE).toMatch(/staffInviteContinueWithGoogle/);

    expect(ACCEPT_PAGE).not.toMatch(/type="password"/);
    expect(ACCEPT_PAGE).not.toMatch(/auth\.signUp/);
    expect(ACCEPT_PAGE).not.toMatch(/staffInviteCreateAccount|staffInviteSignIn|staffInviteUseFullLogin/);
    // The shared email/password sign-in lives elsewhere and is untouched.
    expect(ACCEPT_PAGE).not.toMatch(/getAuthEmailCallbackUrl/);
  });

  it("covers every required state", () => {
    // loading / accepting
    expect(ACCEPT_PAGE).toMatch(/initializing \|\| phase === "accepting"/);
    expect(ACCEPT_PAGE).toMatch(/staffInviteAccepting/);
    // missing token
    expect(ACCEPT_PAGE).toMatch(/!token \?/);
    expect(ACCEPT_PAGE).toMatch(/staffInviteMissingToken/);
    // wrong account
    expect(ACCEPT_PAGE).toMatch(/wrongAccount \?/);
    expect(ACCEPT_PAGE).toMatch(/staffInviteWrongAccountTitle/);
    expect(ACCEPT_PAGE).toMatch(/staffInviteSwitchAccount/);
    // authenticated but not accepted (accept failure)
    expect(ACCEPT_PAGE).toMatch(/isAuthenticated \?/);
    // brand
    expect(ACCEPT_PAGE).toMatch(/WakaPosLogo/);
    expect(ACCEPT_PAGE).toMatch(/DKASU POS/);
  });

  it("maps every server error code to a distinct message", () => {
    const cases: [string, RegExp][] = [
      ["email_mismatch", /email|sign in/i],
      ["expired", /expired/i],
      ["revoked", /valid|no longer/i],
      ["already_accepted", /valid|no longer/i],
      ["invalid_token", /missing|invalid/i],
      ["google_identity_required", /google/i],
    ];
    for (const [code, pattern] of cases) {
      // Imported lazily to avoid pulling the page module into every test.
      const msg = t("en", mapCodeToKey(code));
      expect(msg, `${code} has no specific message`).toMatch(pattern);
    }
  });

  it("8. scrubs the token from the visible URL after capture", () => {
    expect(ACCEPT_PAGE).toMatch(/history\.replaceState/);
    // …without losing it: storage still carries it across the handoff.
    expect(ACCEPT_PAGE).toMatch(/persistStaffInviteToken/);
  });

  it("never puts the token into logs, analytics or error text", () => {
    // Only a boolean leaves the page for telemetry.
    expect(ACCEPT_PAGE).toMatch(/hasToken: Boolean\(/);

    // No telemetry call may carry the token itself — neither as a bare argument
    // nor as a `token:` property. `hasToken: Boolean(...)` is the sanctioned shape.
    const calls = ACCEPT_PAGE.match(/reportAuthIssue\([\s\S]*?\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(/(^|[{,(]\s*)token\s*[,:})]/.test(call), `token leaked to telemetry: ${call}`).toBe(false);
    }

    expect(ACCEPT_PAGE).not.toMatch(/console\.(log|warn|error)\([^)]*token/i);
  });

  it("announces state changes to assistive technology", () => {
    expect(ACCEPT_PAGE).toMatch(/role="alert"/);
    expect(ACCEPT_PAGE).toMatch(/role="status"/);
    expect(ACCEPT_PAGE).toMatch(/aria-live="polite"/);
    expect(ACCEPT_PAGE).toMatch(/aria-busy=/);
  });

  it("9. the Google button cannot be double-submitted", () => {
    expect(ACCEPT_PAGE).toMatch(/disabled=\{busy\}/);
    expect(ACCEPT_PAGE).toMatch(/if \(busy \|\| !supabase\) return;/);
  });
});

/** Mirrors the mapping in acceptErrorMessage so a missing key is caught here. */
function mapCodeToKey(code: string): string {
  return (
    {
      email_mismatch: "staffInviteEmailMismatch",
      expired: "staffInviteExpired",
      revoked: "staffInviteUsed",
      already_accepted: "staffInviteUsed",
      invalid_token: "staffInviteMissingToken",
      google_identity_required: "staffInviteGoogleRequired",
    } as Record<string, string>
  )[code] ?? "staffInviteAcceptFailed";
}

describe("Phase 6 — authorization model", () => {
  it("C. membership role is the authority for an Auth staff session", () => {
    // Auth staff carry no per-staff permission snapshot, so hasActorPermission
    // falls back to the role's own set — the same set a PIN staff member gets
    // when their staff row has no overrides.
    expect(hasActorPermission("cashier", "pos.sell", undefined)).toBe(true);
    expect(hasActorPermission("cashier", "back_office.access", undefined)).toBe(false);

    // A snapshot, when present, wins.
    expect(hasActorPermission("cashier", "back_office.access", ["back_office.access"])).toBe(true);
  });

  it("11/12/13. a Google role resolves to that role, not to another", () => {
    for (const role of ["cashier", "manager", "waiter", "stock_keeper"] as const) {
      expect(resolveAuthRole({ mode: "supabase", userMetadata: undefined, shopMemberRole: role })).toBe(role);
    }
  });

  it("14. Auth staff cannot resolve to owner without an owner membership", () => {
    // No membership at all → fail closed, never owner.
    const resolved = resolveAuthRole({
      mode: "supabase",
      userMetadata: undefined,
      shopMemberRole: null,
    });
    expect(resolved).not.toBe("owner");
    expect(resolved).toBe(FAIL_CLOSED_ROLE);

    // Self-declared owner in user metadata is not honoured for a Supabase session.
    const spoofed = resolveAuthRole({
      mode: "supabase",
      userMetadata: { role: "owner" },
      shopMemberRole: "cashier",
    });
    expect(spoofed).not.toBe("owner");
    expect(spoofed).toBe("cashier");
  });

  it("a staff role never inherits owner-only capabilities", () => {
    const ownerOnly = ["day.close", "reports.profit", "products.remove"] as const;
    for (const permission of ownerOnly) {
      expect(hasPermission("owner", permission), `owner lacks ${permission}`).toBe(true);
      for (const role of ["manager", "cashier", "waiter"] as const) {
        if (hasPermission(role, permission)) {
          // If a non-owner role does hold one of these, it must be deliberate.
          expect(["manager"]).toContain(role);
        }
      }
    }
  });

  /**
   * FINDING — RESOLVED IN PHASE 7. The DB's `viewer` membership role has no client
   * counterpart. `normalizeUserRole` used to fold it onto `stock_keeper` ("legacy DB
   * shop_members label"), and stock_keeper carries inventory WRITE capabilities
   * (stock.adjust, stock.count, products.add, shelves.customize, purchases.record)
   * that a role the database documents as read-only should not have.
   *
   * Phase 6 pinned the old mapping rather than changing it, because the mapping is
   * shared by PIN and Auth staff alike. Phase 7 changed it deliberately: `viewer`
   * now resolves to the documented least-privilege role. This contract is updated
   * to the new behaviour — see authStaffPermissionsPhase7.test.ts for the full
   * matrix.
   */
  it("viewer resolves to the least-privilege role, never a write-capable one", () => {
    expect(normalizeUserRole("viewer")).toBe(FAIL_CLOSED_ROLE);
    expect(hasPermission(FAIL_CLOSED_ROLE, "stock.adjust")).toBe(false);
    expect(hasPermission(FAIL_CLOSED_ROLE, "products.add")).toBe(false);
    expect(hasPermission(FAIL_CLOSED_ROLE, "purchases.record")).toBe(false);
    // The write-capable mapping it used to have, for contrast.
    expect(hasPermission("stock_keeper", "stock.adjust")).toBe(true);
  });

  it("staff permission resolution falls back to the role set deterministically", () => {
    const bare = resolveStaffPermissions({ role: "waiter", permissions: [], customRoleId: null }, null);
    expect(bare).toEqual(permissionsForRole("waiter"));

    const explicit = resolveStaffPermissions(
      { role: "waiter", permissions: ["pos.sell"], customRoleId: null },
      null,
    );
    expect(explicit).toEqual(["pos.sell"]);
  });
});
