import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which Google implementation the staff invitation uses, per platform.
 *
 * The native case runs the REAL `signInWithGoogleNative` against mocked Capacitor plugins, so it
 * proves the invitation reuses the merchant system-browser OAuth implementation rather than a
 * second one — and that the GIS popup path is not reached there.
 */

const isNativePlatform = vi.hoisted(() => vi.fn(() => true));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform, getPlatform: () => "android" },
}));

const browserOpen = vi.hoisted(() =>
  vi.fn<(opts: { url: string }) => Promise<void>>(async () => undefined),
);
const browserClose = vi.hoisted(() => vi.fn(async () => undefined));
const browserListeners = vi.hoisted(() => ({}) as Record<string, () => void>);
vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: browserOpen,
    close: browserClose,
    addListener: (name: string, fn: () => void) => {
      browserListeners[name] = fn;
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: () => Promise.resolve({ remove: () => Promise.resolve() }),
    getLaunchUrl: () => Promise.resolve(undefined),
  },
}));

const AUTHORIZE = "https://ljaedextsenbkxzzgxcg.supabase.co/auth/v1/authorize?provider=google";
const signInWithOAuth = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: { auth: { signInWithOAuth } },
}));

vi.mock("./nativeOAuthBrandedProxy", () => ({
  getSupabaseOAuthCallbackUrl: () => "https://ljaedextsenbkxzzgxcg.supabase.co/auth/v1/callback",
  resolveNativeGoogleOAuthBrowserUrl: async (url: string) => url,
}));

import { signInForStaffInvite } from "./staffInviteGoogleAuth";
import { GOOGLE_SIGN_IN_CANCELLED, signInWithGoogleNative } from "./nativeGoogleAuth";

beforeEach(() => {
  isNativePlatform.mockReturnValue(true);
  browserOpen.mockClear();
  signInWithOAuth.mockReset().mockResolvedValue({ data: { url: AUTHORIZE }, error: null });
  // `nativeGoogleAuth` needs a window for its cancellation timer.
  vi.stubGlobal("window", {
    location: { pathname: "/", search: "", hash: "", replace: vi.fn() },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signInForStaffInvite — platform dispatch", () => {
  it("web picks the GIS popup implementation and never the native one", async () => {
    const native = vi.fn(async () => undefined);
    const web = vi.fn(async () => undefined);

    const via = await signInForStaffInvite({
      isNativePlatform: () => false,
      signInWithNativeGoogle: native,
      signInWithWebGoogle: web,
    });

    expect(via).toBe("web");
    expect(web).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
  });

  it("native runs the REAL system-browser OAuth and never the GIS popup path", async () => {
    let webCalled = false;

    const pending = signInForStaffInvite({
      // The real platform check, backed by the mocked Capacitor plugin.
      isNativePlatform,
      // The real merchant implementation — not a stub.
      signInWithNativeGoogle: signInWithGoogleNative,
      signInWithWebGoogle: async () => {
        webCalled = true;
      },
    });

    // The existing native flow really ran: Supabase authorize → system browser.
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalled());
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth.mock.calls[0]![0]).toMatchObject({
      provider: "google",
      options: { redirectTo: "wakapos://callback" },
    });
    const opened = browserOpen.mock.calls[0]![0] as { url: string };
    expect(opened.url).toBe(AUTHORIZE);

    // Dismissing the Google tab cancels — and must NOT fall through to the GIS popup.
    browserListeners.browserFinished!();
    await expect(pending).rejects.toThrow(GOOGLE_SIGN_IN_CANCELLED);
    expect(webCalled).toBe(false);
  });

  it("propagates a native failure without falling through to the web implementation", async () => {
    let webCalled = false;
    signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: null });

    await expect(
      signInForStaffInvite({
        isNativePlatform: () => true,
        signInWithNativeGoogle: signInWithGoogleNative,
        signInWithWebGoogle: async () => {
          webCalled = true;
        },
      }),
    ).rejects.toThrow("Could not start Google sign-in.");

    expect(webCalled).toBe(false);
  });

  it("reports which implementation ran, so the caller can wait for the native return differently", async () => {
    await expect(
      signInForStaffInvite({
        isNativePlatform: () => false,
        signInWithNativeGoogle: async () => undefined,
        signInWithWebGoogle: async () => undefined,
      }),
    ).resolves.toBe("web");

    await expect(
      signInForStaffInvite({
        isNativePlatform: () => true,
        signInWithNativeGoogle: async () => undefined,
        signInWithWebGoogle: async () => undefined,
      }),
    ).resolves.toBe("native");
  });
});
