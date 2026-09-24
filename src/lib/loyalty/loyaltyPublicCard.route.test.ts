import { describe, expect, it } from "vitest";
import { isPublicLoyaltyCardPath, isStartupPublicPath } from "../nativeApp";
import { isMarketingIndexablePath, noIndexSeoTitle } from "../../config/seoRoutes";
import { loyaltyCanonical } from "../../config/company";

const TOKEN = "c".repeat(64);

describe("public loyalty card route access + SEO", () => {
  it("recognizes /c/:publicCardToken as the canonical public path", () => {
    expect(isPublicLoyaltyCardPath(`/c/${TOKEN}`)).toBe(true);
    expect(isPublicLoyaltyCardPath("/c/short")).toBe(false);
    expect(isPublicLoyaltyCardPath("/c")).toBe(false);
    expect(isPublicLoyaltyCardPath(`/c/${TOKEN}/`)).toBe(true);
    expect(isStartupPublicPath(`/c/${TOKEN}`)).toBe(true);
  });

  it("preserves legacy /loyalty/:publicCardToken recognition", () => {
    expect(isPublicLoyaltyCardPath(`/loyalty/${TOKEN}`)).toBe(true);
    expect(isPublicLoyaltyCardPath("/loyalty/short")).toBe(false);
    expect(isPublicLoyaltyCardPath("/loyalty")).toBe(false);
    expect(isStartupPublicPath(`/loyalty/${TOKEN}`)).toBe(true);
  });

  it("rejects malformed tokens on both prefixes", () => {
    expect(isPublicLoyaltyCardPath(`/c/${"g".repeat(64)}`)).toBe(false);
    expect(isPublicLoyaltyCardPath(`/loyalty/${"G".repeat(63)}a`)).toBe(false);
    expect(isPublicLoyaltyCardPath(`/c/${TOKEN}?next=https://evil.test`)).toBe(true);
  });

  it("is not marketing-indexable and uses loyalty noindex title", () => {
    for (const path of [`/c/${TOKEN}`, `/loyalty/${TOKEN}`]) {
      expect(isMarketingIndexablePath(path)).toBe(false);
      expect(noIndexSeoTitle(path)).toBe("WAKA Loyalty");
    }
  });

  it("token-free canonical path must be used for SEO (B3)", () => {
    expect(TOKEN.length).toBe(64);
    expect(`/c/${TOKEN}`).toContain(TOKEN);
    expect("/c").not.toContain(TOKEN);
    const canonical = loyaltyCanonical("/c");
    expect(canonical).toBe("https://loyalty.waka.ug/c");
    expect(canonical).not.toContain(TOKEN);
  });
});
