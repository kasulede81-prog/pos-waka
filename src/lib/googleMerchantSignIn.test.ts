import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG 1 — an EXISTING merchant signing in with Google.
 *
 * THE DEFECT. `signInWithGoogle` authenticated at Supabase and then returned. It never applied the
 * session and never ran the guarded workspace bootstrap itself — all of that was left to the
 * `onAuthStateChange` listener. The email/password `signIn` has always done both itself. So the two
 * paths were not equivalent: Google depended on a listener that has paths where it deliberately
 * does not act (it returns before `setSession` when the account-key guard cannot switch, and it
 * skips the bootstrap on `TOKEN_REFRESHED`). A session that is authenticated at Supabase but has
 * had no session applied is still `isAuthenticated === false` and still sits on /login.
 *
 * THE RULE THIS FILE PROTECTS. An existing merchant is identified by their TENANCY, which
 * `waka_account_identity()` reports from `shop_members` / `organization_members` — not by intent
 * metadata, and not by anything Google says. A Google identity carries none of our metadata
 * (`pos_role`, `business_name`), so if tenancy were not authoritative an existing merchant would be
 * classified `unknown` and sent to /welcome to declare merchant intent all over again. They must
 * not be.
 *
 * These run the REAL `resolveAccountIdentity` and the REAL `ensureOwnerWorkspaceIfNeeded`, and stub
 * only the transport. A regression in the classifier shows up here.
 */

const rpc = vi.fn();
const refreshSession = vi.fn();
const bootstrapOwnerWorkspace = vi.fn();
const resolvePrimaryOrganizationForUser = vi.fn();
const fetchShopMemberRoleForUser = vi.fn();
const hydrateStaffAuthWorkspace = vi.fn();
const markMemberWorkspace = vi.fn();
const markWorkspaceBootstrapped = vi.fn();

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { refreshSession: () => refreshSession() },
  },
}));

vi.mock("./workspaceBootstrap", () => ({
  bootstrapOwnerWorkspace: (...a: unknown[]) => bootstrapOwnerWorkspace(...a),
}));

vi.mock("./fetchShopSubscription", () => ({
  resolvePrimaryOrganizationForUser: (...a: unknown[]) => resolvePrimaryOrganizationForUser(...a),
}));

vi.mock("./shopMemberRole", () => ({
  fetchShopMemberRoleForUser: (...a: unknown[]) => fetchShopMemberRoleForUser(...a),
}));

vi.mock("./staffInviteOnboarding", () => ({
  resolveStaffInviteBeforeOwnerBootstrap: async () => ({ accepted: false, skipOwnerBootstrap: false }),
}));

vi.mock("./staffAuthHydrate", () => ({
  hydrateStaffAuthWorkspace: (...a: unknown[]) => hydrateStaffAuthWorkspace(...a),
  isNonOwnerShopMemberRole: (role: string | null | undefined) =>
    Boolean(role) && role !== "owner",
}));

vi.mock("./workspaceBootstrapCache", () => ({
  isWorkspaceBootstrapped: () => false,
  isMemberWorkspace: () => false,
  markMemberWorkspace: (...a: unknown[]) => markMemberWorkspace(...a),
  markWorkspaceBootstrapped: (...a: unknown[]) => markWorkspaceBootstrapped(...a),
}));

vi.mock("./startupDiagnostics", () => ({ logStartupPhase: () => {} }));

// businessProfile pulls in the POS store; the phone helper is irrelevant on this path.
vi.mock("./businessProfile", () => ({ normalizeUgPhoneE164: () => null }));

const { ensureOwnerWorkspaceIfNeeded } = await import("./ownerWorkspaceOnSignIn");
const { resolveAccountIdentity, resetMemberIdentityCache, blocksOwnerBootstrap } = await import(
  "./memberIdentity"
);

/**
 * Exactly what a Google identity carries: none of our signup metadata. This is the whole point —
 * every assertion below has to hold WITHOUT `pos_role` / `business_name`.
 */
const GOOGLE_SESSION_METADATA = {};

function session(metadata: Record<string, unknown>) {
  return { user: { id: "u1", user_metadata: metadata } } as never;
}

/** The exact shape `waka_account_identity()` returns. */
function classifierSays(over: Record<string, unknown>) {
  rpc.mockResolvedValue({
    data: {
      ok: true,
      auth_user_id: "u1",
      is_member: false,
      member_id: null,
      is_shop_member: false,
      is_org_member: false,
      has_pending_staff_invite: false,
      merchant_intent: false,
      member_intent: false,
      profile_exists: false,
      ...over,
    },
    error: null,
  });
}

beforeEach(() => {
  rpc.mockReset();
  refreshSession.mockReset().mockResolvedValue(undefined);
  bootstrapOwnerWorkspace.mockReset();
  resolvePrimaryOrganizationForUser.mockReset();
  fetchShopMemberRoleForUser.mockReset();
  hydrateStaffAuthWorkspace.mockReset();
  markMemberWorkspace.mockReset();
  markWorkspaceBootstrapped.mockReset();
  resetMemberIdentityCache();
});

// ===========================================================================
// 2-4. An existing merchant is identified by tenancy, and keeps their workspace
// ===========================================================================

describe("an existing merchant is a merchant because of their TENANCY, not their metadata", () => {
  it("2. resolves `merchant` from shop membership alone, with a pure Google identity", async () => {
    classifierSays({ is_shop_member: true, shop_id: "s1", membership_role: "owner" });

    const resolution = await resolveAccountIdentity({
      userId: "u1",
      metadata: GOOGLE_SESSION_METADATA,
      force: true,
    });

    expect(resolution.kind).toBe("merchant");
    expect(blocksOwnerBootstrap(resolution)).toBe(false);
  });

  it("2b. resolves `merchant` from ORGANIZATION membership too — the owner case", async () => {
    // An owner's tenancy is `organization_members`; `shop_members` may not carry a row for them.
    classifierSays({ is_org_member: true, organization_id: "o1" });

    const resolution = await resolveAccountIdentity({
      userId: "u1",
      metadata: GOOGLE_SESSION_METADATA,
      force: true,
    });

    expect(resolution.kind).toBe("merchant");
  });

  it("3. REUSES the existing workspace — it does not provision a second one", async () => {
    classifierSays({ is_shop_member: true, shop_id: "s1", membership_role: "owner" });
    resolvePrimaryOrganizationForUser.mockResolvedValue({ shopId: "s1", organizationId: "o1" });
    fetchShopMemberRoleForUser.mockResolvedValue("owner");

    await ensureOwnerWorkspaceIfNeeded(session(GOOGLE_SESSION_METADATA));

    // The existing tenancy is the answer: the session is marked ready and nothing is created.
    expect(markWorkspaceBootstrapped).toHaveBeenCalledWith("u1");
    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
    // An owner is not hydrated as staff.
    expect(hydrateStaffAuthWorkspace).not.toHaveBeenCalled();
  });

  it("3b. an existing merchant does NOT need to declare merchant intent again", async () => {
    // The regression this pins: if the classifier fell through to intent metadata, a Google
    // identity (which has none) would be `unknown` and the merchant would be sent to /welcome.
    classifierSays({ is_org_member: true, organization_id: "o1" });
    resolvePrimaryOrganizationForUser.mockResolvedValue({ shopId: "s1", organizationId: "o1" });
    fetchShopMemberRoleForUser.mockResolvedValue("owner");

    await ensureOwnerWorkspaceIfNeeded(session(GOOGLE_SESSION_METADATA));

    // Never `unknown`, and never the unclassified landing.
    const resolution = await resolveAccountIdentity({
      userId: "u1",
      metadata: GOOGLE_SESSION_METADATA,
      force: true,
    });
    expect(resolution.kind).not.toBe("unknown");
    expect(markWorkspaceBootstrapped).toHaveBeenCalled();
  });

  it("4. does NOT become a Loyalty member on the way in", async () => {
    classifierSays({ is_shop_member: true, shop_id: "s1", membership_role: "owner" });
    resolvePrimaryOrganizationForUser.mockResolvedValue({ shopId: "s1", organizationId: "o1" });
    fetchShopMemberRoleForUser.mockResolvedValue("owner");

    await ensureOwnerWorkspaceIfNeeded(session(GOOGLE_SESSION_METADATA));

    expect(markMemberWorkspace).not.toHaveBeenCalled();
    // Nothing in the whole sign-in path names a member RPC.
    const called = rpc.mock.calls.map((c) => String(c[0]));
    expect(called).not.toContain("loyalty_member_register");
    expect(called).not.toContain("loyalty_member_join_by_code");
    expect([...new Set(called)]).toEqual(["waka_account_identity"]);
  });
});

// ===========================================================================
// 5. The control: a Google user with NO tenancy still gets nothing
// ===========================================================================

describe("5. an unknown Google user receives no merchant workspace", () => {
  it("provisions nothing at all", async () => {
    classifierSays({});

    await ensureOwnerWorkspaceIfNeeded(session(GOOGLE_SESSION_METADATA));

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
    // The organization lookup is the last gate before a tenancy — not reached either.
    expect(resolvePrimaryOrganizationForUser).not.toHaveBeenCalled();
    expect(markWorkspaceBootstrapped).not.toHaveBeenCalled();
    expect(markMemberWorkspace).not.toHaveBeenCalled();
  });

  it("is the negative control for the merchant cases above — the bootstrap spy CAN fire", async () => {
    // Without this, "bootstrapOwnerWorkspace was not called" would also pass against a harness that
    // simply cannot observe a bootstrap. An explicit merchant signup must still reach it.
    classifierSays({ merchant_intent: true, profile_exists: true });
    resolvePrimaryOrganizationForUser.mockResolvedValue(null);
    fetchShopMemberRoleForUser.mockResolvedValue(null);

    await ensureOwnerWorkspaceIfNeeded(session({ pos_role: "owner", business_name: "Kiosk" }));

    expect(bootstrapOwnerWorkspace).toHaveBeenCalled();
  });
});

// ===========================================================================
// 1 / 8. The wiring: every Supabase sign-in runs the same completion
// ===========================================================================

const USE_AUTH = readFileSync(join(process.cwd(), "src/hooks/useAuth.ts"), "utf8");

/** The body of a top-level `const <name> = useCallback(` block, up to the next one. */
function hookBody(name: string, nextName: string): string {
  const start = USE_AUTH.indexOf(`const ${name} = useCallback(`);
  expect(start, `${name} must exist`).toBeGreaterThan(0);
  const end = USE_AUTH.indexOf(`const ${nextName} = useCallback(`);
  expect(end, `${nextName} must follow ${name}`).toBeGreaterThan(start);
  return USE_AUTH.slice(start, end);
}

describe("1. Google sign-in completes the session the same way email sign-in does", () => {
  it("the shared completion applies the session AND runs the GUARDED bootstrap", () => {
    const completion = hookBody("completeSupabaseSignIn", "signIn");
    // The session is applied...
    expect(completion).toContain("setSession(signedIn)");
    expect(completion).toContain("applyAccountSwitchSync(");
    expect(completion).toContain("setInitializing(false)");
    // ...and the workspace is resolved through the SAME gated function every other path uses,
    // never a raw provisioning call.
    expect(completion).toContain("ensureWorkspaceRef.current(signedIn)");
    expect(completion).not.toMatch(/bootstrapOwnerWorkspace|bootstrap_owner_workspace/);
  });

  it("email/password sign-in uses it — this path was never the bug", () => {
    const signIn = hookBody("signIn", "signInWithGoogle");
    expect(signIn).toContain("completeSupabaseSignIn(signedIn)");
  });

  it("the WEB Google path uses it — this is the defect that was fixed", () => {
    const google = hookBody("signInWithGoogle", "signUp");
    expect(google).toContain("completeSupabaseSignIn(signedIn)");
  });

  it("the NATIVE Google path uses it too — it used to bootstrap only for a referral", () => {
    const google = hookBody("signInWithGoogle", "signUp");
    // Once, in the web branch, once in the native branch.
    const calls = google.match(/completeSupabaseSignIn\(/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it("the Google handler still provisions nothing directly", () => {
    const google = hookBody("signInWithGoogle", "signUp").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(google).not.toMatch(/bootstrapOwnerWorkspace|bootstrap_owner_workspace/);
    expect(google).not.toMatch(/loyalty_member_register|registerLoyaltyMember|becomeLoyaltyMember/);
    expect(google).not.toMatch(/declareMerchantIntent/);
  });
});
