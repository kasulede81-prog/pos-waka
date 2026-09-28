import { describe, expect, it, vi } from "vitest";

/**
 * `normalizeUgPhoneE164` is the authoritative client-side phone normaliser: merchant signup, phone
 * login, shop profile, owner workspace and public enrollment all route through it, and Phase 2A
 * depends on the value it produces matching a shop's stored phone exactly. It had NO direct test
 * coverage before this file.
 *
 * The stakes are concrete. Every phone column in the schema — `customers.phone_e164`,
 * `loyalty_members.phone_e164`, `loyalty_enrollment_requests.phone_e164` — carries the same
 * `^\+256[0-9]{9}$` CHECK and refuses anything else, so a format this function fails to recognise
 * is not stored in a slightly different shape: it is refused outright, or (worse) the customer
 * value and the member value end up canonical from different inputs and never match.
 */

vi.mock("../store/usePosStore", () => ({
  usePosStore: { getState: () => ({}) },
}));

const { normalizeUgPhoneE164 } = await import("./businessProfile");

describe("normalizeUgPhoneE164 — every accepted Ugandan spelling", () => {
  it("resolves all four forms of ONE number to a single canonical value", () => {
    // This is the property that matters: equivalent spellings must not produce different rows.
    const canonical = "+256772123456";
    expect(normalizeUgPhoneE164("+256772123456")).toBe(canonical);
    expect(normalizeUgPhoneE164("256772123456")).toBe(canonical);
    expect(normalizeUgPhoneE164("0772123456")).toBe(canonical);
    expect(normalizeUgPhoneE164("772123456")).toBe(canonical);
  });

  it("tolerates surrounding whitespace and internal separators", () => {
    expect(normalizeUgPhoneE164("  0772 123 456  ")).toBe("+256772123456");
    expect(normalizeUgPhoneE164("+256 772 123 456")).toBe("+256772123456");
    expect(normalizeUgPhoneE164("0772-123-456")).toBe("+256772123456");
  });

  it("keeps a genuinely different number different", () => {
    expect(normalizeUgPhoneE164("0772123457")).not.toBe(normalizeUgPhoneE164("0772123456"));
  });

  it("always emits the exact shape the database CHECK requires", () => {
    const shapes = ["0772123456", "256772123456", "+256772123456", "772123456"];
    for (const s of shapes) {
      expect(normalizeUgPhoneE164(s), s).toMatch(/^\+256[0-9]{9}$/);
    }
  });
});

describe("normalizeUgPhoneE164 — refuses what it cannot canonicalise", () => {
  it("returns null rather than a guess", () => {
    // A wrong-but-plausible value is worse than null: null is refused loudly, a guess is stored.
    expect(normalizeUgPhoneE164("")).toBeNull();
    expect(normalizeUgPhoneE164("   ")).toBeNull();
    expect(normalizeUgPhoneE164("not a phone")).toBeNull();
    expect(normalizeUgPhoneE164("077212345")).toBeNull(); // one digit short
    expect(normalizeUgPhoneE164("07721234567")).toBeNull(); // one digit long
    expect(normalizeUgPhoneE164("+15551234567")).toBeNull(); // not Ugandan
  });

  it("accepts any 0-prefixed 10-digit number, not only 07x mobiles", () => {
    // Documenting existing behaviour rather than asserting a rule the helper does not implement:
    // the 10-digit branch keys on the leading 0 only, so a non-mobile prefix still canonicalises.
    // That is harmless for matching — both sides of a Phase 2A link run through the same helper
    // and the same CHECK — but it is NOT a mobile-number validator, and must not be relied on as
    // one. Changing it here would silently alter merchant signup and phone login, so it is left
    // exactly as it is and pinned by this test.
    expect(normalizeUgPhoneE164("0872123456")).toBe("+256872123456");
  });
});
