import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALLET_ALLOWED_ORIGINS,
  resolveWalletAllowedOrigins,
} from "../../../../supabase/functions/_shared/loyaltyWallet/walletAllowedOrigins.ts";

/**
 * The Wallet Save-JWT allowlist is a security boundary: Google checks the origin of the page that
 * requests a save against the JWT `origins` claim. The 2026-10-02 auth migration moved the live
 * surfaces to DKASU while the WAKA hosts still 308 there and old tabs stay open — so the fallback
 * must name BOTH generations, and must never widen to a wildcard.
 */
describe("wallet allowed origins (WALLET_ALLOWED_ORIGINS fallback)", () => {
  it("accepts the DKASU POS and Loyalty origins when the secret is unset", () => {
    const origins = resolveWalletAllowedOrigins(undefined);
    expect(origins).toContain("https://pos.dkasu.com");
    expect(origins).toContain("https://loyalty.dkasu.com");
  });

  it("keeps the legacy WAKA origins for the migration window", () => {
    const origins = resolveWalletAllowedOrigins(undefined);
    expect(origins).toContain("https://pos.waka.ug");
    expect(origins).toContain("https://loyalty.waka.ug");
  });

  it("pins the fallback to exactly the four live-plus-legacy surfaces", () => {
    expect([...DEFAULT_WALLET_ALLOWED_ORIGINS].sort()).toEqual(
      [
        "https://loyalty.dkasu.com",
        "https://loyalty.waka.ug",
        "https://pos.dkasu.com",
        "https://pos.waka.ug",
      ].sort(),
    );
  });

  it("falls back when the secret is empty or blank rather than allowing nothing", () => {
    for (const raw of ["", "   ", ",", " , ", null]) {
      expect(resolveWalletAllowedOrigins(raw), String(raw)).toEqual([
        ...DEFAULT_WALLET_ALLOWED_ORIGINS,
      ]);
    }
  });

  it("honours an explicit secret verbatim — trimmed, blanks dropped, nothing added", () => {
    expect(
      resolveWalletAllowedOrigins(" https://pos.dkasu.com , https://staging.example ,"),
    ).toEqual(["https://pos.dkasu.com", "https://staging.example"]);
  });

  it("never contains a wildcard, a bare host, or a non-https origin", () => {
    for (const origin of DEFAULT_WALLET_ALLOWED_ORIGINS) {
      expect(origin, origin).toMatch(/^https:\/\/[a-z0-9.-]+$/);
      expect(origin, origin).not.toContain("*");
    }
  });
});
