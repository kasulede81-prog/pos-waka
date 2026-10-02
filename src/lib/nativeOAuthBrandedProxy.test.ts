import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The branded OAuth proxy had NO test coverage at all before this file, and it sits directly in the
 * native Google path: it rewrites the authorize URL so the account chooser shows `pos.dkasu.com`
 * (the WAKA host until the 2026-10-02 auth migration) rather than `*.supabase.co`.
 *
 * What it must never do is disturb the PARAMETERS. PKCE lives in `code_challenge` / `code_challenge_method`
 * and the round trip's integrity lives in `state` — a rewrite that lost or corrupted either would
 * break the exchange in a way that looks like a Google problem. It also must not touch
 * `redirect_to`, which now carries the app's own scheme.
 */

const SUPABASE = "https://ljaedextsenbkxzzgxcg.supabase.co";
const BRAND = "https://pos.dkasu.com";

const ENV = {
  VITE_SUPABASE_URL: SUPABASE,
  VITE_SUPABASE_ANON_KEY: "anon-key-not-a-secret-in-tests",
};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function load() {
  vi.resetModules();
  return import("./nativeOAuthBrandedProxy");
}

function authorizeUrl(params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `${SUPABASE}/auth/v1/authorize?${q}`;
}

describe("rewriteNativeOAuthAuthorizeUrl", () => {
  it("moves the authorize call onto the branded host", async () => {
    const { rewriteNativeOAuthAuthorizeUrl } = await load();
    const out = rewriteNativeOAuthAuthorizeUrl(authorizeUrl({ provider: "google" }));
    expect(out.startsWith(`${BRAND}/auth/v1/authorize`)).toBe(true);
    expect(out).not.toContain("supabase.co");
  });

  it("PRESERVES PKCE — code_challenge and its method survive verbatim", async () => {
    const { rewriteNativeOAuthAuthorizeUrl } = await load();
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    const out = rewriteNativeOAuthAuthorizeUrl(
      authorizeUrl({
        provider: "google",
        code_challenge: challenge,
        code_challenge_method: "s256",
      }),
    );
    const parsed = new URL(out);
    expect(parsed.searchParams.get("code_challenge")).toBe(challenge);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("s256");
  });

  it("preserves `state`, so the round trip cannot be confused with another", async () => {
    const { rewriteNativeOAuthAuthorizeUrl } = await load();
    const out = rewriteNativeOAuthAuthorizeUrl(authorizeUrl({ provider: "google", state: "state-abc.123" }));
    expect(new URL(out).searchParams.get("state")).toBe("state-abc.123");
  });

  it("leaves the app's own redirect_to scheme alone", async () => {
    // The native return is `wakapos://callback`; only the SUPABASE origin may be rewritten.
    const { rewriteNativeOAuthAuthorizeUrl } = await load();
    const out = rewriteNativeOAuthAuthorizeUrl(
      authorizeUrl({ provider: "google", redirect_to: "wakapos://callback" }),
    );
    expect(new URL(out).searchParams.get("redirect_to")).toBe("wakapos://callback");
  });

  it("also rewrites a supabase origin that appears percent-encoded", async () => {
    const { rewriteNativeOAuthAuthorizeUrl } = await load();
    const out = rewriteNativeOAuthAuthorizeUrl(
      `${SUPABASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${SUPABASE}/x`)}`,
    );
    expect(out).not.toContain(encodeURIComponent("supabase.co"));
  });

  it("returns an unrelated URL untouched", async () => {
    const { rewriteNativeOAuthAuthorizeUrl } = await load();
    const other = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x";
    expect(rewriteNativeOAuthAuthorizeUrl(other)).toBe(other);
  });

  it("returns the input unchanged when Supabase is not configured", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const { rewriteNativeOAuthAuthorizeUrl } = await load();
    const input = authorizeUrl({ provider: "google" });
    expect(rewriteNativeOAuthAuthorizeUrl(input)).toBe(input);
  });

  it("does not rewrite when the brand host IS the supabase host", async () => {
    // Guards the identity case: a self-hosted project must not loop through itself.
    const { rewriteNativeOAuthAuthorizeUrl } = await load();
    const input = authorizeUrl({ provider: "google" });
    expect(rewriteNativeOAuthAuthorizeUrl(input)).toContain("/auth/v1/authorize");
  });
});

describe("getSupabaseOAuthCallbackUrl", () => {
  it("points at the Supabase Google callback, which must stay on *.supabase.co", async () => {
    // Not the branded host: rewriting THIS is what breaks `exchangeCodeForSession`.
    const { getSupabaseOAuthCallbackUrl } = await load();
    expect(getSupabaseOAuthCallbackUrl()).toBe(`${SUPABASE}/auth/v1/callback`);
  });

  it("is null when Supabase is not configured", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const { getSupabaseOAuthCallbackUrl } = await load();
    expect(getSupabaseOAuthCallbackUrl()).toBeNull();
  });
});
