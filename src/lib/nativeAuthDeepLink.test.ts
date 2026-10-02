import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canHandOffToPosApp, normalizeAuthDeepLinkToAppPath } from "./nativeAuthDeepLink";

/**
 * The browser→app handoff. `tryOpenInstalledAppFromBrowserCallback` runs on the WEB page and
 * rewrites it into an `intent://` URL targeting `ug.waka.pos` — so it decides when the POS app
 * takes over a browser session. It used to fire for ANY host whose path contained `/auth/callback`,
 * which meant a Loyalty customer opening their confirmation link on a phone with the POS app
 * installed was pulled into the merchant app.
 */

const navigations: string[] = [];

beforeEach(() => {
  navigations.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Loads the module fresh so `Capacitor` reads the current stub. */
async function load(
  opts: { href: string; userAgent?: string },
) {
  const url = new URL(opts.href);
  const location_ = {
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    href: opts.href,
  };
  vi.stubGlobal("navigator", { userAgent: opts.userAgent ?? "Mozilla/5.0 (Linux; Android 14)" });
  // Reading `href` yields the original URL; assigning it is the handoff, and is recorded.
  Object.defineProperty(location_, "href", {
    configurable: true,
    get: () => opts.href,
    set: (value: string) => {
      navigations.push(value);
    },
  });
  vi.stubGlobal("window", { location: location_ });
  vi.resetModules();
  return import("./nativeAuthDeepLink");
}

async function attempt(hostAndPath: string): Promise<string[]> {
  const mod = await load({ href: hostAndPath });
  mod.tryOpenInstalledAppFromBrowserCallback();
  return navigations;
}

describe("the POS app only claims its own callbacks", () => {
  it("hands a pos.waka.ug callback to the POS app", async () => {
    const nav = await attempt("https://pos.waka.ug/auth/callback?code=abc");
    expect(nav).toHaveLength(1);
    expect(nav[0]).toContain("intent://callback?code=abc");
    expect(nav[0]).toContain("package=ug.waka.pos");
  });

  it("hands a waka.ug callback to the POS app", async () => {
    expect(await attempt("https://waka.ug/auth/callback?code=abc")).toHaveLength(1);
  });

  it("13. NEVER hijacks a loyalty.waka.ug callback into the merchant app", async () => {
    expect(await attempt("https://loyalty.waka.ug/auth/callback?code=abc")).toHaveLength(0);
  });

  it("14. never hijacks an arbitrary host", async () => {
    expect(await attempt("https://evil.com/auth/callback?code=abc")).toHaveLength(0);
    expect(await attempt("https://pos.waka.ug.evil.com/auth/callback?code=abc")).toHaveLength(0);
  });

  it("does nothing on non-Android platforms", async () => {
    const mod = await load({
      href: "https://pos.waka.ug/auth/callback?code=abc",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });
    mod.tryOpenInstalledAppFromBrowserCallback();
    expect(navigations).toHaveLength(0);
  });

  it("agrees with the exported host predicate", () => {
    expect(canHandOffToPosApp("pos.waka.ug")).toBe(true);
    expect(canHandOffToPosApp("loyalty.waka.ug")).toBe(false);
  });
});

describe("normalizeAuthDeepLinkToAppPath", () => {
  it("maps pos.waka.ug email confirm links to in-app route", () => {
    expect(
      normalizeAuthDeepLinkToAppPath(
        "https://pos.waka.ug/auth/callback?code=abc123",
      ),
    ).toBe("/auth/callback?code=abc123");
  });

  it("maps Capacitor localhost OAuth return", () => {
    expect(
      normalizeAuthDeepLinkToAppPath(
        "https://localhost/auth/callback?code=xyz",
      ),
    ).toBe("/auth/callback?code=xyz");
  });

  it("maps custom scheme fallback", () => {
    expect(
      normalizeAuthDeepLinkToAppPath("wakapos://callback?code=custom"),
    ).toBe("/auth/callback?code=custom");
  });

  it("does not map print handoff URLs to auth routes", () => {
    expect(
      normalizeAuthDeepLinkToAppPath(
        "wakapos://print/v1?saleId=aaaaaaaa-1111-4111-8111-111111111111",
      ),
    ).toBeNull();
  });
});
