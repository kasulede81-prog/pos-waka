import { describe, expect, it } from "vitest";
import { normalizeAuthDeepLinkToAppPath } from "./nativeAuthDeepLink";

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
