import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";

/**
 * Phase 2B — discoverability of the public member signup.
 *
 * A signup page nobody can reach is not a signup page. These are source assertions in the same
 * style as `staffV2Phase5Invitation.test.ts`: the project's vitest config only includes files named
 * `.test.ts`, so `.test.tsx` component tests never run, and a source assertion is the only kind of
 * coverage available for a link in JSX.
 *
 * The important ones are the STRUCTURAL assertions — that the destination is exactly the public
 * route, and that the route is declared in the public branch rather than behind `ProtectedRoute`.
 * A link pointing at a gated route would look right in a diff and fail for every real user.
 */

const LOGIN = readFileSync(join(process.cwd(), "src/pages/LoginPage.tsx"), "utf8");
const APP = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");

describe("Phase 2B: the login page exposes member signup", () => {
  it("links to exactly /member/register", () => {
    const marker = LOGIN.indexOf('data-testid="login-member-register"');
    expect(marker, "the member signup link is missing from LoginPage").toBeGreaterThan(0);

    // Read the destination out of the link's own JSX rather than trusting any `to=` in the file.
    const linkJsx = LOGIN.slice(Math.max(0, marker - 400), marker);
    const to = /to="([^"]+)"/.exec(linkJsx)?.[1];
    expect(to).toBe("/member/register");
  });

  it("renders the link through the translation layer, not hardcoded English", () => {
    const marker = LOGIN.indexOf('data-testid="login-member-register"');
    const linkJsx = LOGIN.slice(marker, marker + 400);
    expect(linkJsx).toMatch(/t\(lang, "loginMemberSignupCta"\)/);
    expect(LOGIN).toMatch(/t\(lang, "loginMemberSignupHint"\)/);
  });

  it("does NOT expose the destination only to some users", () => {
    // The link must live in the shared login body, so a plain customer always sees it. If it
    // were nested inside an owner-only conditional it would be invisible to the people it is for.
    const linkIdx = LOGIN.indexOf('data-testid="login-member-register"');
    const supportIdx = LOGIN.indexOf('t(lang, "loginContactSupport")');
    expect(supportIdx).toBeGreaterThan(0);
    expect(linkIdx).toBeLessThan(supportIdx);
  });
});

describe("Phase 2B: the merchant flow is untouched", () => {
  it("keeps the existing merchant registration link and its destination", () => {
    expect(LOGIN).toMatch(/data-testid="login-register-shop"/);
    const marker = LOGIN.indexOf('data-testid="login-register-shop"');
    const linkJsx = LOGIN.slice(Math.max(0, marker - 400), marker);
    expect(/to="([^"]+)"/.exec(linkJsx)?.[1]).toBe("/register");
    expect(LOGIN).toMatch(/t\(lang, "loginCreateNewAccount"\)/);
  });

  it("keeps the loyalty link visually secondary to the merchant card", () => {
    // The merchant action is a full-width bordered card; the loyalty entry is a plain text line.
    const shopMarker = LOGIN.indexOf('data-testid="login-register-shop"');
    const memberMarker = LOGIN.indexOf('data-testid="login-member-register"');
    const shopJsx = LOGIN.slice(Math.max(0, shopMarker - 300), shopMarker);
    expect(shopJsx).toMatch(/rounded-xl border border-border bg-card/);
    const memberJsx = LOGIN.slice(memberMarker, memberMarker + 400);
    expect(memberJsx).not.toMatch(/rounded-xl border border-border bg-card/);
  });
});

describe("Phase 2B: the destination route is public", () => {
  it("declares /member/register in the public branch, not behind ProtectedRoute", () => {
    const routeIdx = APP.indexOf('path="/member/register"');
    const protectedIdx = APP.indexOf("element={<ProtectedRoute");
    expect(routeIdx, "the /member/register route is missing from App.tsx").toBeGreaterThan(0);
    expect(protectedIdx).toBeGreaterThan(0);
    // Declared BEFORE the authenticated branch opens => reachable without a session.
    expect(routeIdx).toBeLessThan(protectedIdx);
  });

  it("still declares the merchant and member surfaces it must not disturb", () => {
    expect(APP).toMatch(/path="\/register"/);
    expect(APP).toMatch(/path="member"/);
    expect(APP).toMatch(/path="welcome"/);
  });
});

describe("Phase 2B: the new strings are actually translated", () => {
  it("defines both keys in English", () => {
    expect(t("en", "loginMemberSignupHint")).toBe("New to DKASU Loyalty?");
    expect(t("en", "loginMemberSignupCta")).toBe("Join DKASU Loyalty");
  });

  it("defines both keys in Luganda rather than falling back to English", () => {
    // `t()` silently falls back to English for a missing key, so a missing Luganda entry would
    // look fine at runtime. Assert the values are present AND localized.
    for (const key of ["loginMemberSignupHint", "loginMemberSignupCta"]) {
      const lg = t("lg", key);
      expect(lg, key).not.toBe(key);
      expect(lg, key).not.toBe(t("en", key));
      expect(lg.length, key).toBeGreaterThan(0);
    }
  });

  it("keeps the existing login strings intact", () => {
    expect(t("en", "loginCreateNewAccount")).toBe("Create a new shop");
    expect(t("lg", "loginCreateNewAccount")).toBe("Tandika dduuka empya");
  });
});
