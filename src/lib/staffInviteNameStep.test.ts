import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  composeFullName,
  namePartsProblem,
  needsNameReview,
  normalizeNamePart,
  provisionableWakaName,
  readConfirmedWakaName,
  reviewPrefill,
  WAKA_FULL_NAME_KEY,
  WAKA_NAME_CONFIRMED_AT_KEY,
} from "./nameReview";

/**
 * The staff invitation's first-time-Google name step.
 *
 * It is NOT a new mechanism: the decision is `needsNameReview`, the prefill is `reviewPrefill`, the
 * validation is `namePartsProblem`/`composeFullName`, and the write is `confirmWakaName` — all of
 * them the merchant signup's own. What these tests pin down is that the staff page uses them, in
 * that order, and that the properties that make them safe still hold.
 *
 * The rendered component cannot be driven here (this repo has no DOM test project); the wiring is
 * asserted against source, and every DECISION below is exercised for real.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const ACCEPT = read("src/pages/StaffAcceptPage.tsx");
const MERCHANT = read("src/pages/StartBusinessPage.tsx");
const FIELDS = read("src/components/auth/NameReviewFields.tsx");

/** What a brand-new Google account carries: provider claims, and no DKASU name. */
const GOOGLE_FIRST_TIME = { full_name: "Mary Nakato", email: "mary@example.com" };
/** What an account that has been through the merchant step carries. */
const ALREADY_CONFIRMED = {
  ...GOOGLE_FIRST_TIME,
  [WAKA_FULL_NAME_KEY]: "Mary N. Nakato",
  [WAKA_NAME_CONFIRMED_AT_KEY]: "2026-10-01T00:00:00.000Z",
};

// ===========================================================================
// The decision: first-time Google → the step appears; existing → it does not
// ===========================================================================

describe("who sees the name step", () => {
  it("a first-time Google staff invitee DOES see it", () => {
    // The staff page passes hasTenancy:false — acceptance is what creates the membership, so this
    // is exactly the moment the merchant flow considers someone un-provisioned.
    expect(needsNameReview({ kind: "merchant", hasTenancy: false, metadata: GOOGLE_FIRST_TIME })).toBe(true);
  });

  it("an existing DKASU user SKIPS it", () => {
    expect(needsNameReview({ kind: "merchant", hasTenancy: false, metadata: ALREADY_CONFIRMED })).toBe(false);
  });

  it("anyone who already has a tenancy skips it, confirmed name or not", () => {
    expect(needsNameReview({ kind: "merchant", hasTenancy: true, metadata: GOOGLE_FIRST_TIME })).toBe(false);
  });

  it("a loyalty member never sees it", () => {
    expect(needsNameReview({ kind: "member", hasTenancy: false, metadata: GOOGLE_FIRST_TIME })).toBe(false);
  });

  it("the staff page asks with the merchant's own predicate, not a bespoke one", () => {
    expect(ACCEPT).toMatch(/needsNameReview\(\{ kind: "merchant", hasTenancy: false, metadata \}\)/);
  });
});

// ===========================================================================
// The Google name is a suggestion, never the answer
// ===========================================================================

describe("the Google profile name is never forced", () => {
  it("prefill seeds the fields from Google so they can be overwritten", () => {
    const prefill = reviewPrefill(GOOGLE_FIRST_TIME);
    expect(prefill.firstName).toBeTruthy();
  });

  it("nothing is written until the person submits — the provider name is not the provisioned name", () => {
    // `provisionableWakaName` is the single gate the RPCs read, and it returns ONLY a confirmed
    // name. This is what stops "Mary Nakato" from Google becoming the DKASU name by default.
    expect(provisionableWakaName(GOOGLE_FIRST_TIME)).toBeUndefined();
    expect(readConfirmedWakaName(GOOGLE_FIRST_TIME)).toBeNull();
  });

  it("a name the person typed IS what gets provisioned", () => {
    const typed = {
      ...GOOGLE_FIRST_TIME,
      [WAKA_FULL_NAME_KEY]: "Marianne Nsubuga",
      [WAKA_NAME_CONFIRMED_AT_KEY]: "2026-10-05T00:00:00.000Z",
    };
    expect(provisionableWakaName(typed)).toBe("Marianne Nsubuga");
  });

  it("a name WITHOUT the confirmation marker is still not provisionable", () => {
    // Both keys are required. A value with no marker is not proof that a person chose it — which
    // is what stops a hand-written `waka_full_name` (or a provider that happened to set one) from
    // being read as a confirmed DKASU name.
    const halfWritten = { ...GOOGLE_FIRST_TIME, [WAKA_FULL_NAME_KEY]: "Not Chosen" };
    expect(provisionableWakaName(halfWritten)).toBeUndefined();
    expect(readConfirmedWakaName(halfWritten)).toBeNull();
  });

  it("the email is not part of the name step at all", () => {
    expect(FIELDS).not.toMatch(/type="email"|value=\{.*email/i);
    expect(ACCEPT).toMatch(/verify the identity|verified identity|not shown as an editable field/);
  });
});

// ===========================================================================
// Validation — the merchant's own
// ===========================================================================

describe("validation is the merchant flow's", () => {
  it("both parts are required, with the merchant's own messages", () => {
    expect(namePartsProblem({ firstName: "", lastName: "Nakato" })?.field).toBe("firstName");
    expect(namePartsProblem({ firstName: "Mary", lastName: "" })?.field).toBe("lastName");
    expect(namePartsProblem({ firstName: "Mary", lastName: "Nakato" })).toBeNull();
  });

  it("the composed name is the person's own words", () => {
    expect(composeFullName("  Mary ", " Nakato  ")).toBe("Mary Nakato");
    expect(normalizeNamePart("  Mary   Nakato ")).toBe("Mary Nakato");
  });

  it("the staff page validates before it writes", () => {
    const handler = ACCEPT.slice(ACCEPT.indexOf("const submitName"));
    const validate = handler.indexOf("namePartsProblem(parts)");
    const write = handler.indexOf("confirmWakaName(");
    expect(validate).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(validate);
  });

  it("it writes through the merchant's own function", () => {
    expect(ACCEPT).toMatch(/confirmWakaName\(\{ fullName: composeFullName\(parts\.firstName, parts\.lastName\) \}\)/);
  });
});

// ===========================================================================
// Ordering, and the invitation security model
// ===========================================================================

describe("the name step runs BEFORE acceptance and does not disturb it", () => {
  it("acceptance waits while the name step is on screen", () => {
    // Scoped to the ACCEPT EFFECT, not the whole file: the first occurrence of the identifier is
    // the import at the top, so searching globally would compare against the wrong thing.
    const effectStart = ACCEPT.lastIndexOf("const controller = attemptRef.current;");
    const effectEnd = ACCEPT.indexOf("}, [initializing, isAuthenticated, token, awaitingName]");
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(effectStart);

    const effect = ACCEPT.slice(effectStart, effectEnd);
    const gate = effect.indexOf("if (awaitingName) return;");
    const accept = effect.indexOf("shouldStartStaffInviteAccept");

    expect(gate).toBeGreaterThan(-1);
    expect(accept).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(accept);
  });

  it("acceptance re-arms once the name is saved", () => {
    const handler = ACCEPT.slice(ACCEPT.indexOf("const submitName"));
    expect(handler.slice(0, 900)).toMatch(/setAwaitingName\(false\)/);
    // …and the effect depends on that flag, which is what re-runs it.
    expect(ACCEPT).toMatch(/\}, \[initializing, isAuthenticated, token, awaitingName\]\);/);
  });

  it("the gate is NOT `phase` — the effect must not re-run mid-attempt", () => {
    // `phase` moves ready→accepting *inside* an in-flight attempt. Depending on it would re-run the
    // effect while its own attempt is running; the narrow flag moves only at the two boundaries.
    const effectStart = ACCEPT.lastIndexOf("const controller = attemptRef.current;");
    const effect = ACCEPT.slice(effectStart, ACCEPT.indexOf("}, [initializing, isAuthenticated, token, awaitingName]"));
    expect(effect).not.toMatch(/\bphase\b/);
  });

  it("the token, the RPC and the Google-identity checks are untouched", () => {
    expect(ACCEPT).toMatch(/acceptStaffInviteToken/);
    expect(ACCEPT).toMatch(/shop_accept_staff_invite|acceptInviteToken/);
    expect(ACCEPT).toMatch(/requestGoogleIdTokenWithNonce/);
    expect(ACCEPT).toMatch(/signInWithIdToken/);
    // No new invitation mechanism, no client-supplied identity.
    expect(ACCEPT).not.toMatch(/p_membership_role|p_role|shop_id:/);
  });

  it("runs even when the account is authenticated already — the step is about the NAME, not the session", () => {
    expect(ACCEPT).toMatch(/needsNameReview\(\{ kind: "merchant", hasTenancy: false, metadata \}\)/);
  });
});

// ===========================================================================
// Reuse, not duplication
// ===========================================================================

describe("one implementation, two surfaces", () => {
  it("the merchant page renders the shared component", () => {
    expect(MERCHANT).toMatch(/<NameReviewFields/);
  });

  it("the staff page renders the same component", () => {
    expect(ACCEPT).toMatch(/<NameReviewFields/);
  });

  it("the fields exist in exactly one place", () => {
    for (const src of [MERCHANT, ACCEPT]) {
      expect(src).not.toMatch(/data-testid="name-review-first-name"/);
      expect(src).not.toMatch(/data-testid="name-review-last-name"/);
    }
    expect(FIELDS).toMatch(/data-testid="name-review-first-name"/);
    expect(FIELDS).toMatch(/data-testid="name-review-last-name"/);
  });
});
