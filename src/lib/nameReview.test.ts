import { describe, expect, it } from "vitest";
import {
  FULL_NAME_MAX,
  NAME_PART_MAX,
  WAKA_FULL_NAME_KEY,
  WAKA_NAME_CONFIRMED_AT_KEY,
  composeFullName,
  displayWakaName,
  namePartsProblem,
  needsNameReview,
  normalizeNamePart,
  providerNameSuggestion,
  provisionableWakaName,
  readConfirmedWakaName,
  reviewPrefill,
  suggestNameParts,
} from "./nameReview";

/**
 * The rule that separates a provider's suggestion from a person's own WAKA name.
 *
 * The bug this file exists for: `user_metadata.full_name` — a value Google owns — was written
 * straight into `profiles.full_name` and displayed as the person's identity. A later login could
 * therefore replace a name the merchant had already chosen. Verified against the live RPC:
 * a non-empty incoming name always wins the bootstrap upsert.
 *
 * The marker pair these tests exercise is deliberately WAKA-owned, so that behaviour of the auth
 * server (which may or may not refresh provider claims on a later sign-in — that was never
 * empirically established) cannot reach a confirmed name either way.
 */

/** A first-time Google merchant: provider data, nothing confirmed yet. */
const GOOGLE_FIRST_TIME = { full_name: "John Smith", name: "John Smith", picture: "https://x/y.png" };

/** A merchant who has confirmed a name that differs from what Google now reports. */
const CONFIRMED_JONATHAN = {
  full_name: "John Smith",
  name: "John Smith",
  [WAKA_FULL_NAME_KEY]: "Jonathan Smith",
  [WAKA_NAME_CONFIRMED_AT_KEY]: "2026-10-01T09:00:00.000Z",
};

describe("splitting a provider name into suggestions", () => {
  it("splits a two-part name", () => {
    expect(suggestNameParts("John Smith")).toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("keeps everything after the first token as the family name", () => {
    // Dropping the remainder would silently lose part of the person's own name.
    expect(suggestNameParts("John van der Berg")).toEqual({ firstName: "John", lastName: "van der Berg" });
    expect(suggestNameParts("Mary Jane Watson")).toEqual({ firstName: "Mary", lastName: "Jane Watson" });
  });

  it("leaves the family name empty for a single-word name", () => {
    // Rather than guessing a surname from one token — the review requires it to be filled in.
    expect(suggestNameParts("Prince")).toEqual({ firstName: "Prince", lastName: "" });
  });

  it("trims and collapses whitespace", () => {
    expect(suggestNameParts("  John   Smith  ")).toEqual({ firstName: "John", lastName: "Smith" });
    expect(suggestNameParts("\tJohn\nSmith ")).toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("handles nothing at all", () => {
    for (const empty of ["", "   ", null, undefined]) {
      expect(suggestNameParts(empty as string)).toEqual({ firstName: "", lastName: "" });
    }
  });
});

describe("preferring split provider claims, falling back to the display name", () => {
  it("uses given_name/family_name when BOTH are present", () => {
    expect(providerNameSuggestion({ given_name: "John", family_name: "Smith", full_name: "J. Smith" }))
      .toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("falls back to splitting the display name when split claims are absent", () => {
    // The claim struct declares given_name/family_name, but they are not guaranteed to be
    // populated for every provider or flow — so they are never assumed.
    expect(providerNameSuggestion({ full_name: "John Smith" })).toEqual({ firstName: "John", lastName: "Smith" });
    expect(providerNameSuggestion({ name: "John Smith" })).toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("does not throw away a surname when only given_name is present", () => {
    // A lone given_name has no surname; the display name does, so the split wins whole.
    expect(providerNameSuggestion({ given_name: "John", full_name: "John Smith" })).toEqual({
      firstName: "John",
      lastName: "Smith",
    });
    // …and when there is no surname anywhere, the lone given_name is still better than nothing.
    expect(providerNameSuggestion({ given_name: "Prince" })).toEqual({ firstName: "Prince", lastName: "" });
  });

  it("survives a Google identity that carries no name at all", () => {
    expect(providerNameSuggestion({ picture: "https://x/y.png" })).toEqual({ firstName: "", lastName: "" });
    expect(providerNameSuggestion(undefined)).toEqual({ firstName: "", lastName: "" });
  });
});

describe("validation and composition", () => {
  it("requires both parts", () => {
    expect(namePartsProblem({ firstName: "", lastName: "Smith" })).toEqual({
      field: "firstName",
      messageKey: "nameReviewFirstNameRequired",
    });
    expect(namePartsProblem({ firstName: "John", lastName: "   " })).toEqual({
      field: "lastName",
      messageKey: "nameReviewLastNameRequired",
    });
    expect(namePartsProblem({ firstName: "John", lastName: "Smith" })).toBeNull();
  });

  it("enforces the existing length limits", () => {
    expect(namePartsProblem({ firstName: "x".repeat(NAME_PART_MAX), lastName: "Smith" })).toBeNull();
    expect(namePartsProblem({ firstName: "x".repeat(NAME_PART_MAX + 1), lastName: "Smith" })).toEqual({
      field: "firstName",
      messageKey: "nameReviewFirstNameTooLong",
    });
    expect(namePartsProblem({ firstName: "John", lastName: "x".repeat(NAME_PART_MAX + 1) })).toEqual({
      field: "lastName",
      messageKey: "nameReviewLastNameTooLong",
    });
  });

  it("composes a normalized full name, and never exceeds what the metadata cap allows", () => {
    expect(composeFullName("  John ", "  Smith ")).toBe("John Smith");
    expect(composeFullName("John", "")).toBe("John");
    expect(composeFullName("", "")).toBe("");
    const longest = composeFullName("x".repeat(NAME_PART_MAX), "y".repeat(NAME_PART_MAX));
    expect(longest.length).toBeLessThanOrEqual(FULL_NAME_MAX);
    // …and the longest pair that is allowed through validation still fits.
    expect(namePartsProblem({ firstName: "x".repeat(NAME_PART_MAX), lastName: "y".repeat(NAME_PART_MAX) })).toBeNull();
  });

  it("normalizeNamePart is the single whitespace rule", () => {
    expect(normalizeNamePart(" a  b ")).toBe("a b");
    expect(normalizeNamePart(null)).toBe("");
  });
});

describe("what counts as a confirmed WAKA name", () => {
  it("is null before the person confirms anything", () => {
    expect(readConfirmedWakaName(GOOGLE_FIRST_TIME)).toBeNull();
    expect(readConfirmedWakaName(undefined)).toBeNull();
    expect(readConfirmedWakaName({})).toBeNull();
  });

  it("A. is the confirmed name once confirmed — even when the provider name differs", () => {
    expect(readConfirmedWakaName(CONFIRMED_JONATHAN)).toBe("Jonathan Smith");
  });

  it("refuses to treat a marker without a value as confirmed", () => {
    // "We cannot say what was confirmed" must re-run the review, not silently keep a provider name.
    expect(readConfirmedWakaName({ [WAKA_NAME_CONFIRMED_AT_KEY]: "2026-10-01T09:00:00Z" })).toBeNull();
    expect(readConfirmedWakaName({ [WAKA_NAME_CONFIRMED_AT_KEY]: "", [WAKA_FULL_NAME_KEY]: "John" })).toBeNull();
    expect(readConfirmedWakaName({ [WAKA_NAME_CONFIRMED_AT_KEY]: "x", [WAKA_FULL_NAME_KEY]: "   " })).toBeNull();
    expect(readConfirmedWakaName({ [WAKA_NAME_CONFIRMED_AT_KEY]: "x", [WAKA_FULL_NAME_KEY]: 42 })).toBeNull();
  });
});

describe("D. provider isolation — a Google name can never reach the profile", () => {
  it("provisionableWakaName is undefined for a first-time Google identity", () => {
    // This is what stops `bootstrap_owner_workspace` writing Google's name into profiles.
    expect(provisionableWakaName(GOOGLE_FIRST_TIME)).toBeUndefined();
  });

  it("it is the CONFIRMED name, never the provider's, once one exists", () => {
    // Even though the provider still reports "John Smith" in full_name / name.
    expect(provisionableWakaName(CONFIRMED_JONATHAN)).toBe("Jonathan Smith");
  });

  it("a marker with no value provisions nothing rather than the provider's name", () => {
    expect(
      provisionableWakaName({ full_name: "John Smith", [WAKA_NAME_CONFIRMED_AT_KEY]: "x" }),
    ).toBeUndefined();
  });
});

describe("display authority", () => {
  it("D. shows the confirmed WAKA name even when the provider now reports another", () => {
    expect(displayWakaName(CONFIRMED_JONATHAN)).toBe("Jonathan Smith");
  });

  it("falls back to the provider suggestion for someone who has not confirmed", () => {
    expect(displayWakaName(GOOGLE_FIRST_TIME)).toBe("John Smith");
    expect(displayWakaName({ name: "John Smith" })).toBe("John Smith");
  });

  it("falls back to the caller's value (an e-mail) when there is no name at all", () => {
    expect(displayWakaName({}, "owner@example.test")).toBe("owner@example.test");
    expect(displayWakaName(undefined, null)).toBeNull();
  });
});

describe("who is asked to review", () => {
  it("F. an already-confirmed merchant is never asked again", () => {
    expect(
      needsNameReview({ kind: "merchant", hasTenancy: true, metadata: CONFIRMED_JONATHAN }),
    ).toBe(false);
  });

  it("F. an existing merchant with a tenancy is not asked even without a marker", () => {
    // Their WAKA identity exists by construction; re-asking on metadata alone is the repeated
    // prompt this must not do.
    expect(needsNameReview({ kind: "merchant", hasTenancy: true, metadata: GOOGLE_FIRST_TIME })).toBe(false);
  });

  it("a first-time Google merchant IS asked", () => {
    expect(needsNameReview({ kind: "unknown", metadata: GOOGLE_FIRST_TIME })).toBe(true);
    expect(needsNameReview({ kind: "merchant", metadata: GOOGLE_FIRST_TIME })).toBe(true);
  });

  it("H. a loyalty member is never asked, whatever their metadata says", () => {
    expect(needsNameReview({ kind: "member", metadata: GOOGLE_FIRST_TIME })).toBe(false);
    expect(needsNameReview({ kind: "member", metadata: {} })).toBe(false);
  });
});

describe("what the review screen starts with", () => {
  it("A/B. pre-fills from the provider for a first-time Google user", () => {
    expect(reviewPrefill(GOOGLE_FIRST_TIME)).toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("prefers the person's own confirmed name over the provider's, if one exists", () => {
    // A returning person's choice is not something a provider gets to overwrite, even as a prefill.
    expect(reviewPrefill(CONFIRMED_JONATHAN)).toEqual({ firstName: "Jonathan", lastName: "Smith" });
  });

  it("pre-fills nothing rather than inventing a name", () => {
    expect(reviewPrefill({ picture: "https://x/y.png" })).toEqual({ firstName: "", lastName: "" });
  });
});
