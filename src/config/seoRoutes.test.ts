import { describe, expect, it } from "vitest";
import { isMarketingIndexablePath, noIndexSeoTitle, normalizePathname } from "./seoRoutes";

describe("seoRoutes", () => {
  it("normalizes trailing slashes", () => {
    expect(normalizePathname("/home/")).toBe("/home");
  });

  it("indexes marketing and legal paths only", () => {
    expect(isMarketingIndexablePath("/home")).toBe(true);
    expect(isMarketingIndexablePath("/acceptable-use")).toBe(true);
    expect(isMarketingIndexablePath("/solutions/pharmacy-pos-uganda")).toBe(true);
    expect(isMarketingIndexablePath("/solutions/inventory-management-uganda")).toBe(true);
    expect(isMarketingIndexablePath("/about/founder")).toBe(true);
    expect(isMarketingIndexablePath("/login")).toBe(false);
    expect(isMarketingIndexablePath("/demo")).toBe(false);
    expect(isMarketingIndexablePath("/verify-agent/WAKA-A1")).toBe(false);
    expect(isMarketingIndexablePath("/internal/waka")).toBe(false);
    expect(isMarketingIndexablePath("/pos")).toBe(false);
  });

  it("returns route-specific noindex titles", () => {
    expect(noIndexSeoTitle("/login")).toBe("Sign in to Waka POS");
    expect(noIndexSeoTitle("/verify-agent/WAKA-A1")).toBe("Verify Waka Agent");
    expect(noIndexSeoTitle("/internal/waka/shops")).toBe("Waka POS Admin");
  });
});
