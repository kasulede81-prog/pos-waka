import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * F-04 — a disabled, deleted or revoked staff identity must NEVER be provisioned an owner
 * workspace.
 *
 * The defect: `waka_account_identity()` is SECURITY DEFINER, so it still reports
 * `is_shop_member: true` for a `shop_members` row that RLS refuses to hand the client — which is
 * exactly what `user_can_access_shop()` does to a non-owner whose `shop_pos_staff` record is
 * inactive or soft-deleted. With `resolvePrimaryOrganizationForUser()` therefore returning null,
 * the sign-in flow read "no shop" as "needs a shop" and bootstrapped one.
 *
 * These tests drive the REAL decision function and the REAL `ensureOwnerWorkspaceIfNeeded`, with
 * only the network boundary mocked, so the refusal is proven where it actually happens.
 */

const ROOT = process.cwd();

const rpc = vi.hoisted(() =>
  vi.fn<(name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>>(async () => ({
    data: { ok: true },
    error: null,
  })),
);
const refreshSession = vi.hoisted(() => vi.fn(async () => ({ data: {}, error: null })));
vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: { auth: { refreshSession }, rpc },
}));

const resolvePrimaryOrganizationForUser = vi.hoisted(() =>
  vi.fn<() => Promise<{ organizationId: string; shopId: string } | null>>(async () => null),
);
vi.mock("./fetchShopSubscription", () => ({ resolvePrimaryOrganizationForUser }));

const resolveStaffInviteBeforeOwnerBootstrap = vi.hoisted(() =>
  vi.fn(async () => ({ skipOwnerBootstrap: false, accepted: false })),
);
vi.mock("./staffInviteOnboarding", () => ({ resolveStaffInviteBeforeOwnerBootstrap }));

const bootstrapOwnerWorkspace = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./workspaceBootstrap", () => ({ bootstrapOwnerWorkspace }));

const markWorkspaceBootstrapped = vi.hoisted(() => vi.fn());
vi.mock("./workspaceBootstrapCache", () => ({
  isWorkspaceBootstrapped: () => false,
  isMemberWorkspace: () => false,
  markWorkspaceBootstrapped,
  markMemberWorkspace: vi.fn(),
}));

vi.mock("./businessProfile", () => ({ normalizeUgPhoneE164: (v: string) => v }));

/** The readable-shop branch hydrates instead of bootstrapping; both are dynamic imports. */
const fetchShopMemberRoleForUser = vi.hoisted(() => vi.fn(async () => "owner" as string | null));
vi.mock("./shopMemberRole", () => ({ fetchShopMemberRoleForUser }));

const hydrateStaffAuthWorkspace = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./staffAuthHydrate", () => ({
  hydrateStaffAuthWorkspace,
  isNonOwnerShopMemberRole: (role: string | null | undefined) => Boolean(role) && role !== "owner",
  clearPersonalStaffTerminalRuntimeState: vi.fn(),
}));

/** Keep the REAL rule; stub only the network call that supplies its input. */
const resolveAccountIdentity = vi.hoisted(() => vi.fn());
vi.mock("./memberIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./memberIdentity")>();
  return { ...actual, resolveAccountIdentity };
});

import {
  blocksOwnerWorkspaceProvisioning,
  resolveFromIdentity,
  type AccountIdentity,
} from "./memberIdentity";
import { ensureOwnerWorkspaceIfNeeded } from "./ownerWorkspaceOnSignIn";

function identity(overrides: Partial<AccountIdentity> = {}): AccountIdentity {
  return {
    authUserId: "auth-user-1",
    isMember: false,
    memberId: null,
    memberStatus: null,
    isShopMember: false,
    shopId: null,
    membershipRole: null,
    isOrgMember: false,
    organizationId: null,
    hasPendingStaffInvite: false,
    merchantIntent: false,
    memberIntent: false,
    profileExists: true,
    ...overrides,
  };
}

/** The REAL classifier, so these tests cannot drift from how a session is actually classified. */
function classify(overrides: Partial<AccountIdentity> = {}) {
  return resolveFromIdentity(identity(overrides), false);
}

const session = {
  user: { id: "auth-user-1", email: "cashier@example.com", user_metadata: {} },
} as never;

beforeEach(() => {
  rpc.mockClear();
  refreshSession.mockClear();
  bootstrapOwnerWorkspace.mockClear();
  markWorkspaceBootstrapped.mockClear();
  resolvePrimaryOrganizationForUser.mockReset().mockResolvedValue(null);
  resolveStaffInviteBeforeOwnerBootstrap
    .mockReset()
    .mockResolvedValue({ skipOwnerBootstrap: false, accepted: false });
  resolveAccountIdentity.mockReset();
});

// ===========================================================================
// The rule
// ===========================================================================

describe("F-04 rule: an existing shop membership that cannot be read is never provisioned", () => {
  it("CASE 2/5 — disabled or inactive staff is blocked", () => {
    const resolution = classify({ isShopMember: true, membershipRole: "cashier", shopId: "shop-1" });
    expect(resolution.kind).toBe("merchant"); // the classifier still calls this a tenancy…
    expect(blocksOwnerWorkspaceProvisioning(resolution, false)).toBe(true); // …and it is refused
  });

  it("CASE 3 — deleted staff is blocked", () => {
    expect(
      blocksOwnerWorkspaceProvisioning(
        classify({ isShopMember: true, membershipRole: "cashier", shopId: "shop-1" }),
        false,
      ),
    ).toBe(true);
  });

  it("CASE 6 — multiple historical shops with zero active access is blocked", () => {
    // `waka_account_identity` reports the FIRST membership; whatever the role, the point is that
    // nothing was readable, so nothing may be created.
    for (const role of ["cashier", "manager", "stock_keeper", "waiter", "viewer"]) {
      expect(
        blocksOwnerWorkspaceProvisioning(
          classify({ isShopMember: true, membershipRole: role, shopId: "shop-1" }),
          false,
        ),
      ).toBe(true);
    }
  });

  it("CASE 4 — membership removed but a staff record remains is blocked (classifies unknown)", () => {
    const resolution = classify({ isShopMember: false, isOrgMember: false });
    expect(resolution.kind).toBe("unknown");
    expect(blocksOwnerWorkspaceProvisioning(resolution, false)).toBe(true);
  });

  it("never blocks once a shop IS readable — the caller has already resolved it", () => {
    expect(
      blocksOwnerWorkspaceProvisioning(
        classify({ isShopMember: true, membershipRole: "cashier", shopId: "shop-1" }),
        true,
      ),
    ).toBe(false);
  });
});

// ===========================================================================
// The other side of the rule — legitimate provisioning is untouched
// ===========================================================================

describe("legitimate owner provisioning is NOT disabled", () => {
  it("TEST 1/14 — a brand-new Google account with merchant intent may still be provisioned", () => {
    const resolution = classify({ merchantIntent: true });
    expect(resolution.kind).toBe("merchant");
    expect(blocksOwnerWorkspaceProvisioning(resolution, false)).toBe(false);
  });

  it("TEST 2 — an existing owner keeps their shop (readable, so never blocked)", () => {
    expect(
      blocksOwnerWorkspaceProvisioning(
        classify({ isShopMember: true, membershipRole: "owner", shopId: "shop-1" }),
        true,
      ),
    ).toBe(false);
  });

  it("TEST 3 — an existing manager keeps their shop", () => {
    expect(
      blocksOwnerWorkspaceProvisioning(
        classify({ isShopMember: true, membershipRole: "manager", shopId: "shop-1" }),
        true,
      ),
    ).toBe(false);
  });

  it("an org member with a broken workspace is still repairable", () => {
    // `bootstrap_owner_workspace` creates an organization_members row, so an owner whose
    // shop_members row was lost looks exactly like this. Blocking here would break the repair path;
    // only a shop_members row is evidence of a staff relationship.
    const resolution = classify({ isOrgMember: true, organizationId: "org-1" });
    expect(blocksOwnerWorkspaceProvisioning(resolution, false)).toBe(false);
  });

  it("TEST 11 — a pending invitation is untouched by this rule", () => {
    const resolution = classify({ hasPendingStaffInvite: true });
    expect(resolution.kind).toBe("merchant");
    // The invitation gate decides first at every call site; the F-04 rule never sees this case.
    expect(resolution.identity?.isShopMember).toBe(false);
  });
});

// ===========================================================================
// The real call site: AuthCallbackPage's path
// ===========================================================================

describe("ensureOwnerWorkspaceIfNeeded refuses for an existing staff identity", () => {
  it("TEST 13 — CALLBACK WITHOUT ANY MARKER cannot turn an existing staff identity into an owner", async () => {
    resolveAccountIdentity.mockResolvedValue(
      classify({ isShopMember: true, membershipRole: "cashier", shopId: "shop-1" }),
    );

    await ensureOwnerWorkspaceIfNeeded(session);

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
    expect(markWorkspaceBootstrapped).not.toHaveBeenCalled();
  });

  it("TEST 9 — zero active staff access bootstraps nothing", async () => {
    resolveAccountIdentity.mockResolvedValue(classify({ isShopMember: false })); // unknown

    await ensureOwnerWorkspaceIfNeeded(session);

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
  });

  it("TEST 1 — a brand-new merchant through the same path still gets a workspace", async () => {
    resolveAccountIdentity.mockResolvedValue(classify({ merchantIntent: true }));

    await ensureOwnerWorkspaceIfNeeded(session);

    expect(bootstrapOwnerWorkspace).toHaveBeenCalledTimes(1);
  });

  it("TEST 2 — an existing owner with a readable shop is hydrated, never re-bootstrapped", async () => {
    resolveAccountIdentity.mockResolvedValue(
      classify({ isShopMember: true, membershipRole: "owner", shopId: "shop-1" }),
    );
    resolvePrimaryOrganizationForUser.mockResolvedValue({ organizationId: "org-1", shopId: "shop-1" });

    await ensureOwnerWorkspaceIfNeeded(session);

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
    expect(markWorkspaceBootstrapped).toHaveBeenCalledWith("auth-user-1");
  });

  it("TEST 11 — a pending invitation still routes to the invitation flow, not the bootstrap", async () => {
    resolveStaffInviteBeforeOwnerBootstrap.mockResolvedValue({ skipOwnerBootstrap: true, accepted: false });
    resolveAccountIdentity.mockResolvedValue(classify({ hasPendingStaffInvite: true }));

    await ensureOwnerWorkspaceIfNeeded(session);

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Authoritative identity, and wiring
// ===========================================================================

describe("TEST 15 — the decision cannot be influenced by a client-supplied user id", () => {
  it("asks waka_account_identity with NO arguments — the identity comes from the JWT", async () => {
    // The REAL classifier, taken un-mocked, driven against the mocked network boundary.
    const actual = await vi.importActual<typeof import("./memberIdentity")>("./memberIdentity");
    rpc.mockClear();

    await actual.resolveAccountIdentity({ userId: "rpc-shape-probe-user", metadata: {} });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe("waka_account_identity");
    // No user id, no shop id, no email: the function has no parameters and derives auth.uid()
    // from the caller's access token. There is no id for a client to supply.
    expect(rpc.mock.calls[0]![1]).toBeUndefined();
  });

  it("the rule depends only on the classifier's answer, never on an id the caller carries", () => {
    const attacker = resolveFromIdentity(identity({ authUserId: "attacker", isShopMember: true }), false);
    const victim = resolveFromIdentity(identity({ authUserId: "victim", isShopMember: true }), false);
    expect(blocksOwnerWorkspaceProvisioning(attacker, false)).toBe(true);
    expect(blocksOwnerWorkspaceProvisioning(victim, false)).toBe(true);
  });
});

describe("wiring — the guard runs before every owner-bootstrap call site", () => {
  const USE_AUTH = readFileSync(resolve(ROOT, "src/hooks/useAuth.ts"), "utf8");
  const CALLBACK_PATH = readFileSync(resolve(ROOT, "src/lib/ownerWorkspaceOnSignIn.ts"), "utf8");

  it("useAuth.ts refuses BEFORE the repair/bootstrap block (which the alreadyEnsured branch also reaches)", () => {
    const guard = USE_AUTH.indexOf("blocksOwnerWorkspaceProvisioning(accountIdentity, false)");
    const firstRepair = USE_AUTH.indexOf("repairOwnerWorkspaceIfNeeded(next.user)");
    const bootstrap = USE_AUTH.indexOf("bootstrapOwnerWorkspace(next.user");

    expect(guard).toBeGreaterThan(0);
    expect(firstRepair).toBeGreaterThan(0);
    expect(bootstrap).toBeGreaterThan(0);
    expect(guard).toBeLessThan(firstRepair);
    expect(guard).toBeLessThan(bootstrap);
  });

  it("ownerWorkspaceOnSignIn.ts refuses before its bootstrap", () => {
    const guard = CALLBACK_PATH.indexOf("blocksOwnerWorkspaceProvisioning(accountIdentity, false)");
    const bootstrap = CALLBACK_PATH.indexOf("bootstrapOwnerWorkspace(session.user");

    expect(guard).toBeGreaterThan(0);
    expect(bootstrap).toBeGreaterThan(0);
    expect(guard).toBeLessThan(bootstrap);
  });

  it("the invitation check still precedes both the F-04 rule and the bootstrap", () => {
    const invite = CALLBACK_PATH.indexOf("inviteGate.skipOwnerBootstrap");
    const guard = CALLBACK_PATH.indexOf("blocksOwnerWorkspaceProvisioning(accountIdentity, false)");
    expect(invite).toBeGreaterThan(0);
    expect(invite).toBeLessThan(guard);
  });

  it("every module that can bootstrap an owner workspace consults the guard", () => {
    for (const file of [
      "src/hooks/useAuth.ts",
      "src/lib/ownerWorkspaceOnSignIn.ts",
      "src/lib/businessProfile.ts",
    ]) {
      const src = readFileSync(resolve(ROOT, file), "utf8");
      expect(src, `${file} must consult blocksOwnerWorkspaceProvisioning`).toMatch(
        /blocksOwnerWorkspaceProvisioning\(/,
      );
    }
  });
});
