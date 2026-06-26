import { describe, expect, it } from "vitest";

/** Mirrors authCallbackSession hash detection for regression coverage. */
function parseHashTokens(href: string): { accessToken: string | null; refreshToken: string | null; type: string | null } {
  const hash = new URL(href).hash.replace(/^#/, "");
  if (!hash) return { accessToken: null, refreshToken: null, type: null };
  const params = new URLSearchParams(hash);
  return {
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    type: params.get("type"),
  };
}

describe("email verify callback hash tokens", () => {
  it("detects implicit-flow tokens in URL hash", () => {
    const href =
      "http://localhost:5173/auth/callback#access_token=abc&refresh_token=def&expires_in=3600&type=signup";
    const parsed = parseHashTokens(href);
    expect(parsed.accessToken).toBe("abc");
    expect(parsed.refreshToken).toBe("def");
    expect(parsed.type).toBe("signup");
  });

  it("returns null when hash is absent", () => {
    const parsed = parseHashTokens("http://localhost:5173/auth/callback?code=pkce-code");
    expect(parsed.accessToken).toBeNull();
    expect(parsed.refreshToken).toBeNull();
  });
});
