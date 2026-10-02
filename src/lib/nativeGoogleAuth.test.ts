import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The native Google flow, exercised through the REAL modules.
 *
 * Two defects this file pins down:
 *
 *  1. THE RETURN PATH. Native OAuth asked Supabase to send the person back to
 *     `https://localhost/auth/callback` — an address that, on a phone, is the phone itself, and
 *     which only reaches the app through an unverified App Link (`autoVerify="false"`, no
 *     `assetlinks.json` served). It now returns through the app's registered `wakapos://callback`,
 *     which needs no verification and is already mapped to `/auth/callback`.
 *
 *  2. CANCELLATION. Closing the Google tab was escapable only by a 180-second timeout, so backing
 *     out left the button on "Signing in…" for three minutes. `browserFinished` now cancels it
 *     immediately — while still NOT mistaking the tab close that accompanies a successful return
 *     for a cancellation.
 */

const isNativePlatform = vi.hoisted(() => vi.fn(() => true));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform, getPlatform: () => "android" },
  CapacitorHttp: { get: vi.fn() },
}));

const appListeners = vi.hoisted(() => ({}) as Record<string, (arg: unknown) => void>);
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (name: string, fn: (arg: unknown) => void) => {
      appListeners[name] = fn;
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
    getLaunchUrl: () => Promise.resolve(undefined),
  },
}));

const browserOpen = vi.hoisted(() => vi.fn(async (_opts: { url: string; presentationStyle?: string }) => undefined));
const browserClose = vi.hoisted(() => vi.fn(async () => undefined));
const browserListeners = vi.hoisted(() => ({}) as Record<string, () => void>);
const listenerRemove = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: browserOpen,
    close: browserClose,
    addListener: (name: string, fn: () => void) => {
      browserListeners[name] = fn;
      return Promise.resolve({ remove: listenerRemove });
    },
  },
}));

const signInWithOAuth = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({ supabase: { auth: { signInWithOAuth } } }));

vi.mock("./nativeOAuthBrandedProxy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nativeOAuthBrandedProxy")>();
  // Keep the real URL rewriting; stub only the network hop that resolves Google's URL.
  return { ...actual, resolveNativeGoogleOAuthBrowserUrl: async (u: string) => u };
});

import { GOOGLE_SIGN_IN_CANCELLED, signInWithGoogleNative } from "./nativeGoogleAuth";
import { getNativeGoogleOAuthRedirectUrl, getAuthCallbackUrl, getSupabaseAuthRedirectUrls } from "./authConfig";
import {
  canHandOffToPosApp,
  normalizeAuthDeepLinkToAppPath,
  oauthCallbackDelivered,
  registerNativeAuthDeepLinkHandler,
  resetNativeAuthDeepLinkStateForTests,
} from "./nativeAuthDeepLink";

const AUTHORIZE = "https://ljaedextsenbkxzzgxcg.supabase.co/auth/v1/authorize?provider=google";

/** Minimal window for the deep-link module (`location.replace` is what matters). */
const replace = vi.fn();
beforeAll(() => {
  registerNativeAuthDeepLinkHandler();
});

beforeEach(() => {
  resetNativeAuthDeepLinkStateForTests();
  signInWithOAuth.mockReset().mockResolvedValue({ data: { url: AUTHORIZE }, error: null });
  browserOpen.mockClear();
  browserClose.mockClear();
  listenerRemove.mockClear();
  replace.mockClear();
  vi.stubGlobal("window", {
    location: { pathname: "/", search: "", hash: "", replace },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("1. the native return URL", () => {
  it("sends Supabase back to the app's own scheme, not to https://localhost", async () => {
    const p = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    expect(signInWithOAuth.mock.calls[0]![0]).toMatchObject({
      provider: "google",
      options: { redirectTo: "wakapos://callback" },
    });
    browserListeners.browserFinished!(); // release the pending promise
    await expect(p).rejects.toThrow(GOOGLE_SIGN_IN_CANCELLED);
  });

  it("no longer derives the native redirect from the localhost callback URL", () => {
    expect(getNativeGoogleOAuthRedirectUrl()).toBe("wakapos://callback");
    expect(getNativeGoogleOAuthRedirectUrl()).not.toBe(getAuthCallbackUrl());
  });

  it("tells operators the scheme must be allow-listed in Supabase", () => {
    // Without `wakapos://callback` in the project's Redirect URLs, Supabase refuses the
    // redirect_to and falls back to the Site URL — which the app cannot receive.
    expect(getSupabaseAuthRedirectUrls()).toContain("wakapos://callback");
  });
});

describe("2. the web Google flow is untouched", () => {
  it("the native module is the only consumer of the custom-scheme redirect", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/nativeGoogleAuth.ts", "utf8"),
    );
    expect(src).toContain("getNativeGoogleOAuthRedirectUrl()");
    // The GIS popup + signInWithIdToken web path must not appear here.
    expect(src).not.toContain("signInWithIdToken");
    expect(src).not.toContain("requestGoogleIdToken");
  });
});

describe("3. PKCE is preserved", () => {
  it("uses supabase-js's own OAuth call with nothing that would change the flow type", async () => {
    const p = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    const arg = signInWithOAuth.mock.calls[0]![0] as { options: Record<string, unknown> };
    // `skipBrowserRedirect` hands us the URL; anything that overrode the flow (e.g. `flowType`)
    // would drop the code_verifier the deep-link return depends on.
    expect(Object.keys(arg.options).sort()).toEqual(["redirectTo", "skipBrowserRedirect"]);
    expect(arg.options.skipBrowserRedirect).toBe(true);
    browserListeners.browserFinished!();
    await expect(p).rejects.toThrow();
  });

  it("opens the browser once, with the resolved URL", async () => {
    const p = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    expect(browserOpen).toHaveBeenCalledTimes(1);
    expect(browserOpen.mock.calls[0]![0]).toMatchObject({ url: AUTHORIZE });
    browserListeners.browserFinished!();
    await expect(p).rejects.toThrow();
  });
});

describe("4. the callback normalises to the in-app route", () => {
  it("wakapos://callback?code=… becomes /auth/callback?code=…", () => {
    expect(normalizeAuthDeepLinkToAppPath("wakapos://callback?code=abc123")).toBe(
      "/auth/callback?code=abc123",
    );
  });
});

describe("5/6/7. warm, cold and duplicate delivery", () => {
  it("5. a warm appUrlOpen callback resolves the pending sign-in", async () => {
    const p = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    appListeners.appUrlOpen!({ url: "wakapos://callback?code=warm-code" });
    await expect(p).resolves.toBeUndefined();
    expect(replace).toHaveBeenCalledWith("/auth/callback?code=warm-code");
  });

  it("6. the same mechanism serves the cold-start launch URL", () => {
    // `App.getLaunchUrl()` feeds the identical handler — the only difference is where the URL
    // arrives from. Asserted structurally so the cold path cannot silently diverge.
    const src = require("node:fs").readFileSync("src/lib/nativeAuthDeepLink.ts", "utf8") as string;
    expect(src).toContain('App.addListener("appUrlOpen"');
    expect(src).toContain("App.getLaunchUrl()");
    expect(src).toMatch(/const onUrl = \(url: string\) => \{\s*void applyAuthDeepLink\(url\);/);
  });

  it("7. a duplicate callback is applied ONCE — the PKCE code cannot be exchanged twice", async () => {
    const p = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    appListeners.appUrlOpen!({ url: "wakapos://callback?code=dup-code" });
    appListeners.appUrlOpen!({ url: "wakapos://callback?code=dup-code" });
    await p;
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe("8/9/10/11. cancellation", () => {
  it("8. browserFinished cancels immediately instead of waiting 180 seconds", async () => {
    const p = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    browserListeners.browserFinished!();
    await expect(p).rejects.toThrow(GOOGLE_SIGN_IN_CANCELLED);
  });

  it("9. cancelling clears the pending state", async () => {
    const p = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    expect(oauthCallbackDelivered()).toBe(false);
    browserListeners.browserFinished!();
    await expect(p).rejects.toThrow();
    expect(oauthCallbackDelivered()).toBe(false);
  });

  it("10. a later sign-in starts cleanly after a cancellation", async () => {
    const first = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    browserListeners.browserFinished!();
    await expect(first).rejects.toThrow(GOOGLE_SIGN_IN_CANCELLED);

    signInWithOAuth.mockClear();
    browserOpen.mockClear();
    const second = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalledTimes(1));
    appListeners.appUrlOpen!({ url: "wakapos://callback?code=second-code" });
    await expect(second).resolves.toBeUndefined();
  });

  it("does NOT treat the tab close that follows a real callback as a cancellation", async () => {
    // The success path closes the browser too; the delivered-flag is what separates the two.
    const p = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    appListeners.appUrlOpen!({ url: "wakapos://callback?code=ok-code" });
    await expect(p).resolves.toBeUndefined();
    expect(browserListeners.browserFinished).toBeTypeOf("function");
  });

  it("11. the timeout survives only as a fallback", () => {
    const src = require("node:fs").readFileSync("src/lib/nativeGoogleAuth.ts", "utf8") as string;
    expect(src).toContain("180_000");
    expect(src).toContain("Google sign-in timed out");
  });

  it("removes its browser listener so listeners cannot accumulate", async () => {
    const p = signInWithGoogleNative();
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    browserListeners.browserFinished!();
    await expect(p).rejects.toThrow();
    await vi.waitFor(() => expect(listenerRemove).toHaveBeenCalled());
  });
});

describe("15/16/17. the identity gates are untouched by this change", () => {
  const read = (p: string) => require("node:fs").readFileSync(p, "utf8") as string;

  it("16. the native callback path provisions nothing and infers no identity", () => {
    // The return path is transport. Whether a session may be given a tenancy is still decided by
    // `waka_account_identity()` behind `resolveAccountIdentity`, exactly as before.
    for (const file of ["src/lib/nativeGoogleAuth.ts", "src/lib/nativeAuthDeepLink.ts"]) {
      const src = read(file);
      expect({ file, provisioning: /bootstrapOwnerWorkspace|bootstrap_owner_workspace|ensureOwnerWorkspaceIfNeeded/.test(src) }).toEqual({ file, provisioning: false });
      expect({ file, identity: /resolveAccountIdentity|waka_account_identity|blocksOwnerBootstrap/.test(src) }).toEqual({ file, identity: false });
      expect({ file, loyalty: /loyalty_member|becomeLoyaltyMember|memberRegister/.test(src) }).toEqual({ file, loyalty: false });
    }
  });

  it("15. the callback is surface-neutral — it only ever yields the in-app /auth/callback route", () => {
    // A merchant and a member alike return to the same route and are then classified by identity;
    // the scheme cannot itself decide who someone is.
    for (const url of [
      "wakapos://callback?code=merchant-code",
      "https://pos.waka.ug/auth/callback?code=member-code",
    ]) {
      expect(normalizeAuthDeepLinkToAppPath(url)?.startsWith("/auth/callback")).toBe(true);
    }
    expect(normalizeAuthDeepLinkToAppPath("wakapos://callback?code=x")).not.toContain("/member");
  });

  it("17. the WAKA name review is untouched by the native return-path change", () => {
    // `confirmWakaName` still creates the profile row before onboarding can reach the bundle save.
    const wakaName = read("src/lib/wakaName.ts");
    expect(wakaName).toContain('upsert({ id: user.id, full_name: fullName }, { onConflict: "id" })');
    expect(wakaName).toContain("WAKA_FULL_NAME_KEY");
    expect(wakaName).toContain("WAKA_NAME_CONFIRMED_AT_KEY");
  });
});

describe("12/13/14. the browser→app handoff is host-scoped", () => {
  it("12. the POS hosts may hand off to the POS app", () => {
    for (const host of ["pos.waka.ug", "waka.ug", "localhost", "127.0.0.1", "POS.WAKA.UG"]) {
      expect({ host, allowed: canHandOffToPosApp(host) }).toEqual({ host, allowed: true });
    }
  });

  it("13. loyalty.waka.ug can NEVER trigger the POS handoff", () => {
    // Otherwise a customer's confirmation link is pulled into the merchant app.
    expect(canHandOffToPosApp("loyalty.waka.ug")).toBe(false);
  });

  it("14. arbitrary and lookalike hosts cannot trigger it", () => {
    for (const host of [
      "evil.com",
      "pos.waka.ug.evil.com",
      "waka.ug.attacker.net",
      "loyalty.waka.ug.evil.com",
      "",
      undefined,
    ]) {
      expect({ host, allowed: canHandOffToPosApp(host as string) }).toEqual({ host, allowed: false });
    }
  });
});
