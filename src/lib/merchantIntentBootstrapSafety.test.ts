import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2C — explicit merchant intent, and the two bootstrap paths it had to close.
 *
 * THE RULE UNDER TEST: merchant intent is NOT merchant authorization.
 *
 * Declaring intent writes metadata and nothing else. Deciding whether that metadata entitles a
 * session to a workspace stays with `waka_account_identity()`, through `resolveAccountIdentity`
 * and `blocksOwnerBootstrap`, exactly as Phase 1 established. Every test below is a way of asking
 * "can something other than the classifier hand out a shop?"
 */

const rpc = vi.fn();
const getUser = vi.fn();
const updateUser = vi.fn();
const bootstrapOwnerWorkspace = vi.fn();
const resolvePrimaryOrganizationForUser = vi.fn();

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return { ...actual, Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } };
});

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: {
      getUser: (...a: unknown[]) => getUser(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      refreshSession: async () => undefined,
    },
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
  markMemberWorkspace: () => {},
  markWorkspaceBootstrapped: () => {},
}));

vi.mock("./startupDiagnostics", () => ({ logStartupPhase: () => {} }));

// Google / email-confirmed identities pass this; we are not testing verification here.
vi.mock("./emailVerification", () => ({ isSupabaseEmailVerified: () => true }));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => ({ preferences: {}, setPreferences: () => {} }),
    setState: () => {},
  },
}));

const { declareMerchantIntent } = await import("./merchantIntent");
const { resetMemberIdentityCache, resolveAccountIdentity, blocksOwnerBootstrap } = await import(
  "./memberIdentity"
);
const { ensureOwnerWorkspaceIfNeeded } = await import("./ownerWorkspaceOnSignIn");
const { saveOwnerBusinessProfileBundleRpc } = await import("./businessProfile");

/** The exact shape `waka_account_identity()` returns. */
function classifierSays(over: Record<string, unknown>) {
  return {
    data: {
      ok: true,
      auth_user_id: "u1",
      is_member: false,
      member_id: null,
      member_status: null,
      is_shop_member: false,
      shop_id: null,
      membership_role: null,
      is_org_member: false,
      organization_id: null,
      has_pending_staff_invite: false,
      merchant_intent: false,
      member_intent: false,
      profile_exists: false,
      ...over,
    },
    error: null,
  };
}

/** Route `rpc` by function name so the classifier and the bundle save do not shadow each other. */
function routeRpc(handlers: {
  identity?: Record<string, unknown>;
  bundle?: { data: unknown; error?: unknown };
}) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "waka_account_identity") return classifierSays(handlers.identity ?? {});
    if (fn === "save_owner_business_profile_bundle") {
      return handlers.bundle ?? { data: { ok: false, error: "no_shop" }, error: null };
    }
    return { data: null, error: null };
  });
}

const GOOGLE_METADATA = {}; // what a Google identity actually carries: none of ours
const MEMBER_METADATA = { account_kind: "member" };
const INTENT_METADATA = { pos_role: "owner", business_name: "Cathy Beauty", organization_name: "Cathy Beauty" };

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  updateUser.mockReset();
  bootstrapOwnerWorkspace.mockReset();
  resolvePrimaryOrganizationForUser.mockReset();
  resetMemberIdentityCache();
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.com", user_metadata: {} } } });
  updateUser.mockResolvedValue({ data: { user: {} }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// F — declaring intent creates NOTHING but metadata
// ===========================================================================

describe("F. declaring merchant intent provisions nothing", () => {
  it("writes the exact metadata shape the Phase 1 gate already recognises", async () => {
    routeRpc({});
    const r = await declareMerchantIntent({ shopName: "Cathy Beauty", ownerName: "Cathy Nakato" });

    expect(r).toEqual({ ok: true });
    const payload = updateUser.mock.calls[0]![0] as { data: Record<string, unknown> };
    // The same keys useAuth.signUp has always written — no new convention for the gate to learn.
    expect(payload.data).toMatchObject({
      pos_role: "owner",
      business_name: "Cathy Beauty",
      organization_name: "Cathy Beauty",
      shop_display_name: "Cathy Beauty",
      full_name: "Cathy Nakato",
    });
  });

  it("creates no organization, shop, subscription or membership — and calls no bootstrap", async () => {
    routeRpc({});
    await declareMerchantIntent({ shopName: "Cathy Beauty" });

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
    const called = new Set(rpc.mock.calls.map((c) => String(c[0])));
    // Not one RPC of any kind: intent is a metadata write, nothing else.
    expect([...called]).toEqual([]);
  });

  it("merges rather than replaces, so a member keeps account_kind", async () => {
    routeRpc({});
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.com", user_metadata: { account_kind: "member", phone_e164: "+256700000001" } } },
    });
    await declareMerchantIntent({ shopName: "Cathy Beauty" });

    const payload = updateUser.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      account_kind: "member",
      phone_e164: "+256700000001",
      pos_role: "owner",
    });
  });

  it("refuses a blank shop name — the gate needs a business name, so there is no intent without one", async () => {
    routeRpc({});
    expect(await declareMerchantIntent({ shopName: "   " })).toEqual({
      ok: false,
      error: "invalid_shop_name",
    });
    expect(updateUser).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// A / B / I — the POS host, with and without intent
// ===========================================================================

describe("A. merchant intent makes /onboarding reachable to an unknown session", () => {
  it("intent flips the classifier from unknown to merchant, which is what the gate admits", async () => {
    // Before: a Google-shaped session is `unknown`, and the gate sends it to /welcome.
    routeRpc({});
    const before = await resolveAccountIdentity({ userId: "u1", metadata: GOOGLE_METADATA, force: true });
    expect(before.kind).toBe("unknown");

    // After declaring intent the classifier answers `merchant` — the ONLY thing that admits a
    // session past KnownIdentityGate into /onboarding.
    resetMemberIdentityCache();
    routeRpc({});
    const after = await resolveAccountIdentity({ userId: "u1", metadata: INTENT_METADATA, force: true });
    expect(after.kind).toBe("merchant");
    expect(blocksOwnerBootstrap(after)).toBe(false);
  });

  it("the intent route is declared OUTSIDE the identity gate", () => {
    // If /start-business ever moved inside KnownIdentityGate it would be unreachable to exactly
    // the sessions it exists for, and the /welcome -> /register -> /onboarding loop would return.
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const lines = app.split("\n");
    const indent = (re: string) => {
      const i = lines.findIndex((l) => l.includes(re));
      return i < 0 ? -1 : lines[i]!.match(/^\s*/)![0].length;
    };
    const start = indent('path="start-business"');
    const gate = indent("element={<KnownIdentityGate");
    const welcome = indent('path="welcome"');
    expect(start).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(0);
    expect(start, "/start-business must not be nested inside KnownIdentityGate").toBeLessThanOrEqual(gate);
    expect(start, "/start-business should sit beside /welcome").toBe(welcome);
  });

  it("/welcome sends 'Set up a business' to the intent step, not to the /register loop", () => {
    const welcome = readFileSync(join(process.cwd(), "src/pages/member/WelcomePage.tsx"), "utf8");
    expect(welcome).toContain('to="/start-business"');
  });

  it("the intent step creates nothing itself — it only navigates to /onboarding", () => {
    const page = readFileSync(join(process.cwd(), "src/pages/StartBusinessPage.tsx"), "utf8");
    expect(page).toContain('navigate("/onboarding"');
    expect(page).not.toMatch(/bootstrapOwnerWorkspace|bootstrap_owner_workspace/);
  });
});

describe("B / I. an unknown session without intent provisions nothing", () => {
  it("a metadata-less (Google-shaped) session bootstraps nothing", async () => {
    routeRpc({});
    await ensureOwnerWorkspaceIfNeeded({ user: { id: "u1", user_metadata: GOOGLE_METADATA } } as never);
    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
  });

  it("even with a tenancy-free shop-membership absence, unknown stays unknown", async () => {
    routeRpc({});
    const r = await resolveAccountIdentity({ userId: "u1", metadata: GOOGLE_METADATA, force: true });
    expect(r.kind).toBe("unknown");
    expect(blocksOwnerBootstrap(r)).toBe(true);
  });
});

describe("C. the loyalty host never bootstraps a merchant workspace", () => {
  it("host intent does not reach classification, so an unknown loyalty session is still unknown", async () => {
    // productHost is deliberately absent from every bootstrap path — asserted directly.
    for (const f of ["src/hooks/useAuth.ts", "src/lib/memberIdentity.ts", "src/lib/ownerWorkspaceOnSignIn.ts", "src/lib/workspaceBootstrap.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/productHost|isLoyaltySurface|getProductAuthIntent/);
    }
  });
});

// ===========================================================================
// D / E — existing identities keep their kind
// ===========================================================================

describe("D. an existing member is not displaced by merchant intent", () => {
  it("a registered member with intent metadata still resolves member", async () => {
    // Precedence: member (intent + row) is checked BEFORE merchant intent, so declaring intent
    // can never turn a member into a merchant.
    routeRpc({ identity: { is_member: true, member_id: "m1", member_status: "active", member_intent: true } });
    const r = await resolveAccountIdentity({
      userId: "u1",
      metadata: { ...MEMBER_METADATA, ...INTENT_METADATA },
      force: true,
    });
    expect(r.kind).toBe("member");
    expect(blocksOwnerBootstrap(r)).toBe(true);
  });

  it("a member session visiting onboarding is bootstrapped by nobody", async () => {
    routeRpc({ identity: { is_member: true, member_id: "m1", member_intent: true } });
    await ensureOwnerWorkspaceIfNeeded({
      user: { id: "u1", user_metadata: { ...MEMBER_METADATA, ...INTENT_METADATA } },
    } as never);
    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
  });
});

describe("E / G. an existing merchant, and a completed onboarding, are unchanged", () => {
  it("an existing tenancy is merchant regardless of what else is on the account", async () => {
    routeRpc({ identity: { is_shop_member: true, shop_id: "s1", is_member: true, member_id: "m1" } });
    const r = await resolveAccountIdentity({ userId: "u1", metadata: MEMBER_METADATA, force: true });
    expect(r.kind).toBe("merchant");
  });

  it("a merchant who declared intent still bootstraps exactly as before", async () => {
    routeRpc({});
    resolvePrimaryOrganizationForUser.mockResolvedValue(null);
    await ensureOwnerWorkspaceIfNeeded({ user: { id: "u1", user_metadata: INTENT_METADATA } } as never);
    expect(bootstrapOwnerWorkspace).toHaveBeenCalled();
  });
});

// ===========================================================================
// H — the two businessProfile bootstrap callers cannot bypass the classifier
// ===========================================================================

describe("H. the businessProfile bootstrap callers obey the identity authority", () => {
  const bundleArgs = {
    shopName: "Cathy Beauty",
    businessType: "kiosk_duka" as const,
    districtId: "d1",
    phoneE164: "+256700000001",
    currency: "UGX",
  };

  it("REFUSES to bootstrap for a member, even though the RPC says no_shop", async () => {
    routeRpc({ identity: { is_member: true, member_id: "m1", member_intent: true } });
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.com", user_metadata: MEMBER_METADATA } },
    });

    const r = await saveOwnerBusinessProfileBundleRpc(bundleArgs);
    expect(r).toEqual({ ok: false, message: "not_authorized_for_workspace" });
    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
  });

  it("REFUSES to bootstrap for an unclassified session", async () => {
    routeRpc({ identity: {} });
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.com", user_metadata: GOOGLE_METADATA } },
    });

    const r = await saveOwnerBusinessProfileBundleRpc(bundleArgs);
    expect(r).toEqual({ ok: false, message: "not_authorized_for_workspace" });
    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
  });

  it("STILL bootstraps for a merchant — the guard is a check, not a block", async () => {
    // Positive control. Without it the two refusals above would pass against a guard that simply
    // always refused, and merchant onboarding would be silently broken.
    routeRpc({ identity: { merchant_intent: true } });
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.com", user_metadata: INTENT_METADATA } },
    });
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "waka_account_identity") return classifierSays({ merchant_intent: true });
      if (fn === "save_owner_business_profile_bundle") {
        return bootstrapOwnerWorkspace.mock.calls.length === 0
          ? { data: { ok: false, error: "no_shop" }, error: null }
          : { data: { ok: true, shop_id: "s1", organization_id: "o1" }, error: null };
      }
      return { data: null, error: null };
    });

    const r = await saveOwnerBusinessProfileBundleRpc(bundleArgs);
    expect(bootstrapOwnerWorkspace).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it("both call sites in businessProfile.ts are guarded", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/businessProfile.ts"), "utf8");
    const guards = src.match(/mayCreateOwnerWorkspace\(/g) ?? [];
    // one definition + two call sites
    expect(guards.length).toBe(3);
    // and the authority is actually consulted, not reimplemented
    expect(src).toMatch(/resolveAccountIdentity\(/);
    // Phase 3 (F-04): the guard is now the STRONGER of the two authorities in the same module —
    // `blocksOwnerWorkspaceProvisioning`, which adds the fail-closed rule for an identity that holds
    // a shop membership no client can read (a disabled or deleted staff record). The property this
    // test protects is unchanged: the module consults the identity authority rather than deciding
    // for itself. `blocksOwnerBootstrap` is still exported and still tested in memberIdentity.test.ts.
    expect(src).toMatch(/blocksOwnerWorkspaceProvisioning\(/);
  });
});

// ===========================================================================
// J / K — where existing identities land
// ===========================================================================

describe("J / K. existing identities keep their surface", () => {
  it("the loyalty login sends an authenticated session to /member", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/member/LoyaltyLoginPage.tsx"), "utf8");
    expect(src).toMatch(/if \(isAuthenticated\) return <Navigate to="\/member" replace \/>;/);
  });

  it("the merchant login still sends an authenticated session into the merchant branch", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/LoginPage.tsx"), "utf8");
    expect(src).toMatch(/if \(isAuthenticated\) \{\s*\n\s*return <Navigate to=\{staffInviteNext \?\? "\/"\} replace \/>;/);
  });
});

// ===========================================================================
// L — a member is kept out of the merchant intent flow
// ===========================================================================

describe("L. a registered member cannot enter the merchant intent flow", () => {
  const readPage = () => readFileSync(join(process.cwd(), "src/pages/StartBusinessPage.tsx"), "utf8");

  it("member resolves to the redirect the page keys on", async () => {
    routeRpc({ identity: { is_member: true, member_id: "m1", member_status: "active", member_intent: true } });
    const r = await resolveAccountIdentity({ userId: "u1", metadata: MEMBER_METADATA, force: true });
    // The page sends exactly this kind to /member.
    expect(r.kind).toBe("member");
  });

  it("the page consults the classifier and redirects members to /member", () => {
    const src = readPage();
    expect(src).toMatch(/resolveAccountIdentity\(/);
    expect(src).toMatch(/resolution\.kind === "member" \? "member" : "allowed"/);
    expect(src).toMatch(/if \(gate === "member"\) return <Navigate to="\/member" replace \/>;/);
  });

  it("the redirect happens BEFORE the form can render", () => {
    const src = readPage();
    const redirect = src.indexOf('<Navigate to="/member"');
    const form = src.indexOf('data-testid="start-business-shop-name"');
    expect(redirect).toBeGreaterThan(0);
    expect(form).toBeGreaterThan(0);
    expect(redirect, "the member redirect must precede the form").toBeLessThan(form);
  });

  it("unknown and merchant are both allowed through", async () => {
    // unknown — the case this page exists for.
    routeRpc({ identity: {} });
    const unknown = await resolveAccountIdentity({ userId: "u1", metadata: GOOGLE_METADATA, force: true });
    expect(unknown.kind).toBe("unknown");

    // merchant — harmless to let them re-declare; the identity gate admits them regardless.
    resetMemberIdentityCache();
    routeRpc({ identity: { merchant_intent: true } });
    const merchant = await resolveAccountIdentity({ userId: "u1", metadata: INTENT_METADATA, force: true });
    expect(merchant.kind).toBe("merchant");
  });

  it("a member who bypassed the redirect STILL cannot obtain a tenancy", async () => {
    // The redirect is cosmetic by design. Even writing intent metadata for a member leaves them a
    // member, because the member row is checked BEFORE merchant intent — so the guarded bootstrap
    // refuses. This is what makes the redirect safe to be a UI-only guard.
    routeRpc({ identity: { is_member: true, member_id: "m1", member_intent: true } });
    const r = await resolveAccountIdentity({
      userId: "u1",
      metadata: { ...MEMBER_METADATA, ...INTENT_METADATA },
      force: true,
    });
    expect(r.kind).toBe("member");
    expect(blocksOwnerBootstrap(r)).toBe(true);
  });

  it("intent alone still creates no tenancy from this route", () => {
    const src = readPage();
    // The page declares intent and navigates — it never provisions.
    expect(src).toMatch(/navigate\("\/onboarding"/);
    expect(src).not.toMatch(/bootstrapOwnerWorkspace|bootstrap_owner_workspace/);
    expect(src).not.toMatch(/\.rpc\(/);
  });

  it("the guard is a redirect, not an authorization check", () => {
    const src = readPage();
    // It must not claim to decide anything: no error state, no blocking message — just a Navigate.
    expect(src).not.toMatch(/not_authorized|forbidden/i);
  });
});
