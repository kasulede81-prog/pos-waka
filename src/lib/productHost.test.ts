import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DKASU_LOYALTY_PRODUCT_HOST,
  DKASU_POS_PRODUCT_HOST,
  getProductAuthIntent,
  isLoyaltyHost,
  isLoyaltySurface,
  isLoyaltySurfacePath,
  isPosHost,
  LOYALTY_PRODUCT_HOST,
  normalizeHostname,
  POS_PRODUCT_HOST,
  productOriginForHostname,
} from "./productHost";

/**
 * Phase 2C — the hostname decides which product a session belongs to.
 *
 * The stakes: `getProductAuthIntent` is what separates "I came here to collect points" from "I came
 * here to run my shop". If it answers wrong in the merchant direction a customer is offered a POS
 * onboarding; if it answers wrong the other way a merchant could be routed at the customer app.
 * So the mapping is pinned here, including the hosts it must NOT claim.
 *
 * The vitest environment is `node`, so there is no `window` unless a test stubs one. That is a
 * feature: the unstubbed cases below are the real "no browser / unknown host" path.
 */

function withHost(hostname: string): void {
  vi.stubGlobal("window", { location: { hostname, origin: `https://${hostname}` } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("host classification", () => {
  it("maps the two product hosts", () => {
    expect(isPosHost(POS_PRODUCT_HOST)).toBe(true);
    expect(isLoyaltyHost(POS_PRODUCT_HOST)).toBe(false);

    expect(isLoyaltyHost(LOYALTY_PRODUCT_HOST)).toBe(true);
    expect(isPosHost(LOYALTY_PRODUCT_HOST)).toBe(false);
  });

  it("normalises case, port and a trailing root dot", () => {
    expect(normalizeHostname("  POS.WAKA.UG  ")).toBe(POS_PRODUCT_HOST);
    expect(normalizeHostname("pos.waka.ug:443")).toBe(POS_PRODUCT_HOST);
    expect(normalizeHostname("loyalty.waka.ug.")).toBe(LOYALTY_PRODUCT_HOST);
    expect(normalizeHostname("")).toBe("");
    expect(normalizeHostname(null)).toBe("");
    expect(normalizeHostname(undefined)).toBe("");
    // And the classification agrees with the normaliser rather than only with a clean string.
    expect(isLoyaltyHost("LOYALTY.WAKA.UG:443")).toBe(true);
  });

  it("does not claim a host that merely contains a product host", () => {
    // A lookalike must not inherit the customer surface.
    expect(isLoyaltyHost("loyalty.waka.ug.evil.com")).toBe(false);
    expect(isPosHost("pos.waka.ug.evil.com")).toBe(false);
    expect(isLoyaltyHost("www.loyalty.waka.ug")).toBe(false);
    expect(isPosHost("waka.ug")).toBe(false);
  });
});

describe("getProductAuthIntent — the host decides the product", () => {
  it("pos.waka.ug is merchant", () => {
    expect(getProductAuthIntent(POS_PRODUCT_HOST)).toBe("merchant");
  });

  it("loyalty.waka.ug is member", () => {
    expect(getProductAuthIntent(LOYALTY_PRODUCT_HOST)).toBe("member");
  });

  it("every non-product host defaults to merchant — the existing behaviour everywhere", () => {
    // Merchant is the safe default: every current deployment, every dev machine and the Android
    // shell are POS surfaces, so an unknown host must not silently become the loyalty app.
    for (const host of [
      "",
      "localhost",
      "127.0.0.1",
      "192.168.1.20",
      "pos-waka-git-main-team.vercel.app",
      "waka.ug",
      "example.com",
    ]) {
      expect(getProductAuthIntent(host), host).toBe("merchant");
    }
  });

  it("reads the live hostname when no host is passed", () => {
    withHost(LOYALTY_PRODUCT_HOST);
    expect(getProductAuthIntent()).toBe("member");
    expect(isLoyaltySurface()).toBe(true);

    withHost(POS_PRODUCT_HOST);
    expect(getProductAuthIntent()).toBe("merchant");
    expect(isLoyaltySurface()).toBe(false);
  });

  it("defaults to merchant when there is no window at all (node / native bootstrap)", () => {
    expect(getProductAuthIntent()).toBe("merchant");
    expect(isLoyaltySurface()).toBe(false);
  });
});

describe("VITE_PRODUCT_INTENT is a dev-only override that cannot touch production", () => {
  it("opts an unknown host into the customer surface", () => {
    vi.stubEnv("VITE_PRODUCT_INTENT", "member");
    expect(getProductAuthIntent("localhost")).toBe("member");
    expect(getProductAuthIntent("pos-waka-preview.vercel.app")).toBe("member");
  });

  it("opts an unknown host back into the merchant surface", () => {
    vi.stubEnv("VITE_PRODUCT_INTENT", "merchant");
    expect(getProductAuthIntent("localhost")).toBe("merchant");
  });

  it("is IGNORED on a real product host, so production stays deterministic", () => {
    // A stray env var must never flip a production origin into the wrong product.
    vi.stubEnv("VITE_PRODUCT_INTENT", "member");
    expect(getProductAuthIntent(POS_PRODUCT_HOST)).toBe("merchant");

    vi.stubEnv("VITE_PRODUCT_INTENT", "merchant");
    expect(getProductAuthIntent(LOYALTY_PRODUCT_HOST)).toBe("member");
  });

  it("ignores an unrecognised value", () => {
    vi.stubEnv("VITE_PRODUCT_INTENT", "yes-please");
    expect(getProductAuthIntent("localhost")).toBe("merchant");
  });
});

describe("productOriginForHostname", () => {
  it("returns the canonical public origin per product — DKASU since the auth migration", () => {
    // Both host generations classify to the same product AND the same canonical origin: a session
    // that starts on a WAKA host performs its auth round trip on the DKASU origin.
    expect(productOriginForHostname(POS_PRODUCT_HOST)).toBe("https://pos.dkasu.com");
    expect(productOriginForHostname(DKASU_POS_PRODUCT_HOST)).toBe("https://pos.dkasu.com");
    expect(productOriginForHostname(LOYALTY_PRODUCT_HOST)).toBe("https://loyalty.dkasu.com");
    expect(productOriginForHostname(DKASU_LOYALTY_PRODUCT_HOST)).toBe("https://loyalty.dkasu.com");
  });

  it("returns null for anything else rather than guessing an origin", () => {
    // null is what lets authConfig keep its pre-existing fallback behaviour on every other host.
    for (const host of ["", "localhost", "127.0.0.1", "pos-waka.vercel.app", "waka.ug"]) {
      expect(productOriginForHostname(host), host).toBeNull();
    }
  });
});

describe("the loyalty surface is an allow list", () => {
  it("admits the customer journey and the auth handoff", () => {
    for (const path of [
      "/login",
      "/member",
      "/member/register",
      "/auth/callback",
      "/verify-email",
      "/forgot-password",
      "/auth/recovery",
      "/reset-password",
      "/terms",
      "/privacy",
      "/acceptable-use",
      "/support",
    ]) {
      expect(isLoyaltySurfacePath(path), path).toBe(true);
    }
  });

  it("admits a card share link and an enrollment link", () => {
    const token = "a".repeat(64);
    expect(isLoyaltySurfacePath(`/c/${token}`)).toBe(true);
    expect(isLoyaltySurfacePath(`/loyalty/${token}`)).toBe(true);
    expect(isLoyaltySurfacePath(`/join/${token}`)).toBe(true);
  });

  it("rejects the merchant POS surface", () => {
    // Every one of these is a merchant route that must not be reachable on the loyalty host.
    for (const path of [
      "/",
      "/register",
      "/welcome",
      "/onboarding",
      "/activate",
      "/office",
      "/office/loyalty",
      "/stock",
      "/settings",
      "/staff/accept",
      "/internal/waka",
      "/verify-agent/WAKA-A8F7",
    ]) {
      expect(isLoyaltySurfacePath(path), path).toBe(false);
    }
  });

  it("tolerates a trailing slash and ignores the query string", () => {
    expect(isLoyaltySurfacePath("/member/")).toBe(true);
    expect(isLoyaltySurfacePath("/login?next=/member")).toBe(true);
    expect(isLoyaltySurfacePath("/office/")).toBe(false);
  });
});
