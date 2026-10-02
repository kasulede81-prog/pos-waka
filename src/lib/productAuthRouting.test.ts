import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2C — host-aware auth routing, and the bootstrap boundary it must not cross.
 *
 * Two halves, and the second is the one that matters:
 *
 *  1. The redirect a session returns to is derived from the HOST, so an OAuth round trip lands back
 *     on the surface it started from. That return host is what carries product intent — nothing
 *     reads Google profile data for it, and nothing needs to be stashed.
 *
 *  2. Product intent selects a SURFACE. It does not grant anything. A loyalty-host session still
 *     provisions nothing, and `waka_account_identity()` remains the only thing that decides
 *     whether a session is a merchant or a member. These tests run the REAL `resolveAccountIdentity`
 *     and only stub the RPC transport, so a regression in the classifier shows up here.
 */

const rpc = vi.fn();
const refreshSession = vi.fn();
const bootstrapOwnerWorkspace = vi.fn();
const resolvePrimaryOrganizationForUser = vi.fn();
const markMemberWorkspace = vi.fn();
const markWorkspaceBootstrapped = vi.fn();

/** Flipped per test so one file can exercise both the web and the native branch. */
const capacitor = { native: false };

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    Capacitor: {
      isNativePlatform: () => capacitor.native,
      getPlatform: () => (capacitor.native ? "android" : "web"),
    },
  };
});

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

// businessProfile pulls in the POS store; the phone helper is irrelevant on these paths.
vi.mock("./businessProfile", () => ({ normalizeUgPhoneE164: () => null }));

const authConfig = await import("./authConfig");
const { resetMemberIdentityCache, resolveAccountIdentity, blocksOwnerBootstrap } = await import("./memberIdentity");
const { ensureOwnerWorkspaceIfNeeded } = await import("./ownerWorkspaceOnSignIn");
const { getProductAuthIntent } = await import("./productHost");

function withHost(hostname: string, origin = `https://${hostname}`): void {
  vi.stubGlobal("window", { location: { hostname, origin } });
}

beforeEach(() => {
  rpc.mockReset();
  refreshSession.mockReset().mockResolvedValue(undefined);
  bootstrapOwnerWorkspace.mockReset();
  resolvePrimaryOrganizationForUser.mockReset();
  markMemberWorkspace.mockReset();
  markWorkspaceBootstrapped.mockReset();
  capacitor.native = false;
  resetMemberIdentityCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// 1. Host-aware callback URLs
// ---------------------------------------------------------------------------

describe("callback URLs preserve the product surface, on DKASU origins since the migration", () => {
  it("a POS host returns to the DKASU POS origin — both host generations classify", () => {
    for (const host of ["pos.waka.ug", "pos.dkasu.com"]) {
      withHost(host);
      expect(authConfig.authRedirectOrigin(), host).toBe("https://pos.dkasu.com");
      expect(authConfig.getAuthCallbackUrl(), host).toBe("https://pos.dkasu.com/auth/callback");
      expect(authConfig.getAuthEmailCallbackUrl(), host).toBe("https://pos.dkasu.com/auth/callback");
      expect(authConfig.getAuthRecoveryUrl(), host).toBe("https://pos.dkasu.com/reset-password");
    }
  });

  it("a loyalty host returns to the DKASU loyalty origin — the return origin IS the intent", () => {
    for (const host of ["loyalty.waka.ug", "loyalty.dkasu.com"]) {
      withHost(host);
      expect(authConfig.authRedirectOrigin(), host).toBe("https://loyalty.dkasu.com");
      expect(authConfig.getAuthCallbackUrl(), host).toBe("https://loyalty.dkasu.com/auth/callback");
      expect(authConfig.getAuthEmailCallbackUrl(), host).toBe("https://loyalty.dkasu.com/auth/callback");
      expect(authConfig.getAuthRecoveryUrl(), host).toBe("https://loyalty.dkasu.com/reset-password");
      expect(authConfig.getAuthEmailRecoveryUrl(), host).toBe("https://loyalty.dkasu.com/reset-password");
    }
  });

  it("the two products never redirect into each other", () => {
    withHost("loyalty.dkasu.com");
    const loyaltyCallback = authConfig.getAuthCallbackUrl();
    withHost("pos.dkasu.com");
    const posCallback = authConfig.getAuthCallbackUrl();

    expect(loyaltyCallback).not.toBe(posCallback);
    expect(loyaltyCallback).not.toContain("pos.dkasu.com");
    expect(posCallback).not.toContain("loyalty.dkasu.com");
  });

  it("keeps the pre-existing behaviour on a host that is neither product", () => {
    // localhost, LAN, a Vercel preview: unchanged, and emails still go to the public POS origin.
    withHost("localhost", "http://localhost:5173");
    expect(authConfig.getAuthEmailCallbackUrl()).toBe("https://pos.dkasu.com/auth/callback");
    expect(authConfig.getAuthEmailRecoveryUrl()).toBe("https://pos.dkasu.com/reset-password");

    withHost("pos-waka-git-main-team.vercel.app");
    expect(authConfig.getAuthEmailCallbackUrl()).toBe("https://pos.dkasu.com/auth/callback");
  });

  it("never puts https://localhost in an email link", () => {
    // Mail clients open these outside the Capacitor WebView, where https://localhost goes nowhere.
    withHost("localhost", "https://localhost");
    expect(authConfig.getAuthEmailCallbackUrl()).not.toContain("localhost");
    expect(authConfig.getAuthEmailRecoveryUrl()).not.toContain("localhost");
  });
});

describe("the Android shell is untouched by host routing", () => {
  it("still returns to https://localhost/auth/callback", () => {
    capacitor.native = true;
    withHost("localhost", "https://localhost");

    expect(authConfig.getAuthCallbackUrl()).toBe("https://localhost/auth/callback");
    expect(authConfig.getAuthRecoveryUrl()).toBe("https://localhost/reset-password");
    // The native shell is a POS surface: it must never be treated as the customer app.
    expect(getProductAuthIntent()).toBe("merchant");
  });

  it("email links from the native shell still use the public POS origin", () => {
    capacitor.native = true;
    withHost("localhost", "https://localhost");
    expect(authConfig.getAuthEmailCallbackUrl()).toBe("https://pos.dkasu.com/auth/callback");
  });
});

describe("the redirect allowlist documents both surfaces and both host generations", () => {
  it("lists the DKASU callbacks and the legacy WAKA ones", () => {
    const urls = authConfig.getSupabaseAuthRedirectUrls();
    for (const required of [
      "https://pos.dkasu.com/auth/callback",
      "https://pos.dkasu.com/reset-password",
      "https://loyalty.dkasu.com/auth/callback",
      "https://loyalty.dkasu.com/reset-password",
      // Kept for the migration window — old emails and bookmarks still land on these hosts.
      "https://pos.waka.ug/auth/callback",
      "https://loyalty.waka.ug/auth/callback",
      "https://localhost/auth/callback",
      "http://localhost:5173/auth/callback",
    ]) {
      expect(urls, required).toContain(required);
    }
  });

  it("lists the DKASU origins and the legacy WAKA ones as Google JavaScript origins", () => {
    const origins = authConfig.getGoogleOAuthJavaScriptOrigins();
    for (const required of [
      "https://pos.dkasu.com",
      "https://loyalty.dkasu.com",
      "https://dkasu.com",
      "https://pos.waka.ug",
      "https://loyalty.waka.ug",
    ]) {
      expect(origins, required).toContain(required);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Product intent must not provision anything
// ---------------------------------------------------------------------------

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

/** What a Google identity actually carries: none of our metadata. */
const GOOGLE_SESSION_METADATA = {};

describe("SECURITY: intent selects a surface, never a tenancy", () => {
  it("a brand-new Google session on loyalty.waka.ug bootstraps no merchant workspace", async () => {
    withHost("loyalty.waka.ug");
    expect(getProductAuthIntent()).toBe("member");
    classifierSays({});

    await ensureOwnerWorkspaceIfNeeded(session(GOOGLE_SESSION_METADATA));

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
    // The organization lookup is the last gate before a tenancy is created — not reached either.
    expect(resolvePrimaryOrganizationForUser).not.toHaveBeenCalled();
    expect(markWorkspaceBootstrapped).not.toHaveBeenCalled();
  });

  it("a brand-new Google session on pos.waka.ug also provisions nothing", async () => {
    // Preserves the Phase 1 guarantee: only an EXPLICIT merchant signup gets a shop. Being on the
    // merchant host is not merchant intent, so Google sign-in must not auto-create one.
    withHost("pos.waka.ug");
    classifierSays({});

    await ensureOwnerWorkspaceIfNeeded(session(GOOGLE_SESSION_METADATA));

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
  });

  it("a loyalty-host Google session is never classified as a merchant OR as a member", async () => {
    withHost("loyalty.waka.ug");
    classifierSays({});

    const resolution = await resolveAccountIdentity({
      userId: "u1",
      metadata: GOOGLE_SESSION_METADATA,
      force: true,
    });

    // `unknown` is the only correct answer: no tenancy, no member row, no intent metadata.
    expect(resolution.kind).toBe("unknown");
    expect(blocksOwnerBootstrap(resolution)).toBe(true);
  });

  it("an unreachable classifier on the loyalty host fails closed", async () => {
    withHost("loyalty.waka.ug");
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });

    await ensureOwnerWorkspaceIfNeeded(session(GOOGLE_SESSION_METADATA));

    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
  });
});

describe("existing identities keep their kind, on either host", () => {
  it("an existing merchant stays a merchant", async () => {
    for (const host of ["pos.waka.ug", "loyalty.waka.ug"]) {
      withHost(host);
      resetMemberIdentityCache();
      classifierSays({ is_shop_member: true, shop_id: "s1", membership_role: "owner" });

      const resolution = await resolveAccountIdentity({
        userId: "u1",
        metadata: GOOGLE_SESSION_METADATA,
        force: true,
      });

      expect(resolution.kind, host).toBe("merchant");
      expect(blocksOwnerBootstrap(resolution), host).toBe(false);
    }
  });

  it("an existing member stays a member, even on the merchant host", async () => {
    withHost("pos.waka.ug");
    classifierSays({ is_member: true, member_id: "m1", member_status: "active", member_intent: true });

    const resolution = await resolveAccountIdentity({
      userId: "u1",
      metadata: { account_kind: "member" },
      force: true,
    });

    expect(resolution.kind).toBe("member");
    expect(blocksOwnerBootstrap(resolution)).toBe(true);
  });

  it("a merchant who is also a loyalty member keeps the merchant path", async () => {
    // Tenancy is checked first, so a merchant is never displaced by their own loyalty row.
    withHost("loyalty.waka.ug");
    classifierSays({
      is_shop_member: true,
      shop_id: "s1",
      is_member: true,
      member_id: "m1",
      member_intent: true,
    });

    const resolution = await resolveAccountIdentity({
      userId: "u1",
      metadata: { account_kind: "member" },
      force: true,
    });

    expect(resolution.kind).toBe("merchant");
  });

  it("a merchant with real tenancy still bootstraps on the merchant host", async () => {
    // Control case: proves the spy can see a bootstrap, so the negatives above mean something.
    withHost("pos.waka.ug");
    classifierSays({ merchant_intent: true, profile_exists: true });
    resolvePrimaryOrganizationForUser.mockResolvedValue(null);

    await ensureOwnerWorkspaceIfNeeded(session({ pos_role: "owner", business_name: "Kiosk" }));

    expect(bootstrapOwnerWorkspace).toHaveBeenCalled();
  });
});

describe("no silent account merging", () => {
  it("classifying a new session issues only the read-only identity RPC", async () => {
    withHost("loyalty.waka.ug");
    classifierSays({});

    await ensureOwnerWorkspaceIfNeeded(session(GOOGLE_SESSION_METADATA));
    await resolveAccountIdentity({ userId: "u1", metadata: GOOGLE_SESSION_METADATA, force: true });

    // One classifier read. No claim, no link, no register, no bootstrap — so host-derived intent
    // cannot attach this auth user to somebody else's merchant or loyalty account.
    const calls = new Set(rpc.mock.calls.map((c) => String(c[0])));
    expect([...calls]).toEqual(["waka_account_identity"]);
  });

  it("two different auth users never resolve to the same identity", async () => {
    withHost("loyalty.waka.ug");
    classifierSays({});

    const a = await resolveAccountIdentity({ userId: "user-a", metadata: {}, force: true });
    const b = await resolveAccountIdentity({ userId: "user-b", metadata: {}, force: true });

    expect(a.kind).toBe("unknown");
    expect(b.kind).toBe("unknown");
    // Each carries its own auth user id — the RPC takes no user parameter, it reads auth.uid().
    expect(rpc.mock.calls.every((c) => c.length === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. The wiring, as shipped
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const APP = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
const LOGIN = readFileSync(join(ROOT, "src/pages/LoginPage.tsx"), "utf8");
const LOYALTY_LOGIN = readFileSync(join(ROOT, "src/pages/member/LoyaltyLoginPage.tsx"), "utf8");
const CALLBACK = readFileSync(join(ROOT, "src/pages/AuthCallbackPage.tsx"), "utf8");

describe("Phase 2C wiring", () => {
  it("wraps the route tree in the loyalty surface boundary", () => {
    expect(APP).toContain("<LoyaltySurfaceBoundary>");
    const open = APP.indexOf("<LoyaltySurfaceBoundary>");
    const routes = APP.indexOf("<Routes>");
    const close = APP.indexOf("</LoyaltySurfaceBoundary>");
    expect(open).toBeGreaterThan(0);
    expect(routes).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(routes);
  });

  it("switches only /login by host", () => {
    expect(APP).toMatch(/isLoyaltySurface\(\)\s*\?\s*\(/);
    expect(APP).toContain("<LoyaltyLoginPage");
    expect(APP).toContain("<LoginPage");
  });

  it("does not delete or re-parent the merchant routes", () => {
    for (const route of ['path="/register"', 'path="member"', 'path="welcome"', 'path="/member/register"']) {
      expect(APP, route).toContain(route);
    }
  });

  it("keeps the merchant login on the existing Google UI architecture", () => {
    // Requirement: the POS login keeps using the SAME GoogleSignInButton, gated by the same flag.
    expect(LOGIN).toContain("GoogleSignInButton");
    expect(LOGIN).toContain("isGoogleAuthUiAvailable");
    expect(LOGIN).toContain("onGoogleLogin");
  });

  it("renders the customer login through the same GoogleSignInButton", () => {
    expect(LOYALTY_LOGIN).toContain('from "../../components/auth/GoogleSignInButton"');
    expect(LOYALTY_LOGIN).toContain("isGoogleAuthUiAvailable");
    expect(LOYALTY_LOGIN).toContain("<GoogleSignInButton");
    // Email/password remains as the fallback.
    expect(LOYALTY_LOGIN).toContain("onLogin(email, password)");
  });

  it("does not enable Google — no flag is written anywhere in the new code", () => {
    for (const src of [LOYALTY_LOGIN, APP]) {
      expect(src).not.toMatch(/VITE_ENABLE_GOOGLE_AUTH\s*=\s*["']?true/);
    }
  });

  it("sends a loyalty-host session to the member surface, not the POS chooser", () => {
    expect(CALLBACK).toContain("isLoyaltySurface()");
    // The bootstrap guard itself must NOT have been weakened.
    expect(CALLBACK).toContain("const memberOnly = accountIdentity.kind !== \"merchant\";");
    expect(CALLBACK).toContain("if (!inviteGate.skipOwnerBootstrap && !memberOnly)");
  });
});
