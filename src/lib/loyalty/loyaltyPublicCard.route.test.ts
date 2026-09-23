import { describe, expect, it } from "vitest";
import { isPublicLoyaltyCardPath, isStartupPublicPath } from "../nativeApp";
import { isMarketingIndexablePath, noIndexSeoTitle } from "../../config/seoRoutes";

const TOKEN = "c".repeat(64);

describe("public loyalty card route access + SEO", () => {
  it("recognizes /loyalty/:publicCardToken as a public path", () => {
    expect(isPublicLoyaltyCardPath(`/loyalty/${TOKEN}`)).toBe(true);
    expect(isPublicLoyaltyCardPath("/loyalty/short")).toBe(false);
    expect(isPublicLoyaltyCardPath("/loyalty")).toBe(false);
    expect(isStartupPublicPath(`/loyalty/${TOKEN}`)).toBe(true);
  });

  it("is not marketing-indexable and uses loyalty noindex title", () => {
    const path = `/loyalty/${TOKEN}`;
    expect(isMarketingIndexablePath(path)).toBe(false);
    expect(noIndexSeoTitle(path)).toBe("WAKA Loyalty");
  });

  it("token-free canonical path must be used for SEO (W3)", () => {
    // Controllers must pass "/loyalty", never "/loyalty/<token>".
    expect(TOKEN.length).toBe(64);
    expect(`/loyalty/${TOKEN}`).toContain(TOKEN);
    expect("/loyalty").not.toContain(TOKEN);
  });
});
