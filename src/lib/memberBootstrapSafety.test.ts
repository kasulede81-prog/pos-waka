import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2B — THE regression test for public member signup.
 *
 * `ensureOwnerWorkspaceIfNeeded` is the path `AuthCallbackPage` calls INDEPENDENTLY of
 * `ensureWorkspaceForSession`, straight after email confirmation. It is the shortest route from
 * "auth user" to "owner of a new shop", so it is where a member signup would do the most damage.
 *
 * The real `resolveAccountIdentity` is used, not a stub — the classification is the thing under
 * test. Only the RPC transport is mocked, and it answers with genuine `waka_account_identity()`
 * response shapes.
 *
 * A merchant case is included deliberately. Without it, "bootstrap was not called" would also pass
 * against a harness that simply cannot observe a bootstrap; the merchant case proves the spy works
 * and the bootstrap genuinely fires when it should.
 */

const rpc = vi.fn();
const refreshSession = vi.fn();
const bootstrapOwnerWorkspace = vi.fn();
const resolvePrimaryOrganizationForUser = vi.fn();
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

vi.mock("./staffInviteOnboarding", () => ({
  resolveStaffInviteBeforeOwnerBootstrap: async () => ({ accepted: false, skipOwnerBootstrap: false }),
}));

vi.mock("./workspaceBootstrapCache", () => ({
  isWorkspaceBootstrapped: () => false,
  isMemberWorkspace: () => false,
  markMemberWorkspace: (...a: unknown[]) => markMemberWorkspace(...a),
  markWorkspaceBootstrapped: (...a: unknown[]) => markWorkspaceBootstrapped(...a),
}));

vi.mock("./startupDiagnostics", () => ({ logStartupPhase: () => {} }));

// businessProfile pulls in the POS store; the phone helper is irrelevant to this path.
vi.mock("./businessProfile", () => ({ normalizeUgPhoneE164: () => null }));

const { ensureOwnerWorkspaceIfNeeded } = await import("./ownerWorkspaceOnSignIn");
const { resetMemberIdentityCache } = await import("./memberIdentity");

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
  markMemberWorkspace.mockReset();
  markWorkspaceBootstrapped.mockReset();
  resetMemberIdentityCache();
});

describe("SECURITY: a member signup cannot reach an owner workspace", () => {
  it("a fresh member-intent signup (intent, NO member row) bootstraps nothing", async () => {
    // This is precisely the state the public signup leaves behind.
    classifierSays({ member_intent: true, is_member: false });

    await ensureOwnerWorkspaceIfNeeded(session({ account_kind: "member" }));

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
    // The organization lookup is the last gate before a tenancy is created — not reached either.
    expect(resolvePrimaryOrganizationForUser).not.toHaveBeenCalled();
    expect(markWorkspaceBootstrapped).not.toHaveBeenCalled();
  });

  it("a member WITH a row also bootstraps nothing", async () => {
    classifierSays({ member_intent: true, is_member: true, member_id: "m1", member_status: "active" });

    await ensureOwnerWorkspaceIfNeeded(session({ account_kind: "member" }));

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
    expect(resolvePrimaryOrganizationForUser).not.toHaveBeenCalled();
    expect(markMemberWorkspace).toHaveBeenCalledWith("u1");
  });

  it("an unreachable classifier bootstraps nothing — fail closed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });

    await ensureOwnerWorkspaceIfNeeded(session({ account_kind: "member" }));

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
  });

  it("a merchant signup still bootstraps — proving the spy can see a bootstrap", async () => {
    // Control case. If this ever stops firing, the three negatives above become meaningless.
    classifierSays({ merchant_intent: true, profile_exists: true });
    resolvePrimaryOrganizationForUser.mockResolvedValue(null);

    await ensureOwnerWorkspaceIfNeeded(session({ pos_role: "owner", business_name: "Kiosk" }));

    expect(bootstrapOwnerWorkspace).toHaveBeenCalled();
  });
});
