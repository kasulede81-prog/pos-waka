import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeUgPhoneE164 } from "../businessProfile";

/**
 * BUG 2 — the phone number is MANDATORY for a new DKASU Loyalty member.
 *
 * WHERE THE HOLE WAS. Two of them, and only one was on the client:
 *
 *   1. SERVER (the real bypass). `loyalty_member_register`'s format check only ran when the phone
 *      was NON-NULL — `if v_phone is not null and v_phone !~ …` — so a NULL passed straight into
 *      the INSERT. The RPC is granted to `authenticated` and can be called directly, so any
 *      signed-in caller could create a member with no phone: an identity that can never join
 *      anything, because `loyalty_member_join_by_code` refuses it with `member_phone_required`.
 *      Closed by `20260929180000_loyalty_member_register_requires_phone.sql`, and pinned by
 *      `loyaltyMemberRegisterPhone.sql.integration.test.ts`.
 *
 *   2. CLIENT (defence in depth, and the field-level message). The join form's phone field carried
 *      the HTML `required` attribute — which a single space satisfies — and the profile step
 *      deferred all validation to `becomeLoyaltyMember`. A round trip that fails is a worse
 *      experience than a field that refuses, and it left the rule expressed in three places with
 *      the form not one of them.
 *
 * The client assertions below are structural (vitest only includes `*.test.ts`); the behaviour they
 * describe is asserted against the real source and the real normalizer.
 *
 * THE RULE, stated once: no `loyalty_members` row may be created without a canonical Ugandan phone,
 * and a Google identity never supplies one.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const PAGE = read("src/pages/PublicLoyaltyProgramPage.tsx");
const REGISTRATION = read("src/lib/memberRegistration.ts");

/** The body of the authenticated profile step, up to the anonymous submit handler. */
const PROFILE_STEP = PAGE.slice(
  PAGE.indexOf("const createProfileThenJoin"),
  PAGE.indexOf("// ---------------------------------------------------------------- anonymous"),
);

// ===========================================================================
// 1-5. Every rejected spelling is rejected by the canonical normalizer
// ===========================================================================

describe("1-5. what the canonical normalizer accepts, and what it refuses", () => {
  it("1. an empty phone cannot be normalized — there is nothing to send", () => {
    expect(normalizeUgPhoneE164("")).toBeNull();
  });

  it("2. a whitespace-only phone is NOT a value", () => {
    // The case HTML `required` lets through.
    for (const blank of [" ", "   ", "\t", "\n"]) {
      expect(normalizeUgPhoneE164(blank), JSON.stringify(blank)).toBeNull();
    }
  });

  it("3. a phone that cannot become a canonical Ugandan number is refused", () => {
    for (const bad of [
      "nonsense",
      "077212345", // too short
      "07721234567", // too long
      "+15551234567", // not Uganda
      "077212345a", // not a number at all
      "+25677212345", // 8 digits after the country code
    ]) {
      expect(normalizeUgPhoneE164(bad), bad).toBeNull();
    }
  });

  it("3b. the boundary of what counts as VALID is unchanged — deliberately", () => {
    // `+256072123456` (a 0 left after the country code) is accepted by the shared normalizer, and
    // by the identical SQL regex `^\+256[0-9]{9}$` and the Edge Function copies of the same
    // helper — they agree, so nothing is silently rejected at one layer and stored at another.
    //
    // It is PRE-EXISTING behaviour, it is shared with merchant onboarding and `profiles`, and it
    // is not the defect: a lax-looking number is still A number, and it can still be linked. The
    // rule this suite protects is that a member cannot be created with NO phone. Tightening the
    // shared normalizer is a separate change with its own blast radius, so it is pinned here as a
    // conscious decision rather than quietly altered.
    expect(normalizeUgPhoneE164("+256072123456")).toBe("+256072123456");
    expect("+256072123456").toMatch(/^\+256[0-9]{9}$/);
  });

  it("4. a valid Ugandan phone is accepted in every spelling a person types", () => {
    for (const good of ["0772123456", "256772123456", "+256772123456", "772123456", "0772 123 456", "0772-123-456"]) {
      expect(normalizeUgPhoneE164(good), good).toBe("+256772123456");
    }
  });

  it("5. the accepted value is ALWAYS the canonical E.164 form", () => {
    const canonical = "+256772123456";
    const results = ["0772123456", "0772 123 456", "+256 772 123 456", "256772123456"].map((v) =>
      normalizeUgPhoneE164(v),
    );
    expect(new Set(results)).toEqual(new Set([canonical]));
    // …and that is the exact shape the column CHECK and the RPC regex demand.
    expect(canonical).toMatch(/^\+256[0-9]{9}$/);
  });
});

// ===========================================================================
// 6 / 7 / 11. The registration path cannot create a member without a phone
// ===========================================================================

describe("6. registration refuses a phone-less member before the call leaves the client", () => {
  it("becomeLoyaltyMember validates the phone and returns before the RPC", () => {
    const code = stripComments(REGISTRATION);
    const normalize = code.indexOf("normalizeUgPhoneE164(input.phone)");
    const rpcCall = code.indexOf("registerLoyaltyMember(");
    expect(normalize).toBeGreaterThan(0);
    expect(rpcCall).toBeGreaterThan(normalize);
    // The refusal precedes the call, so no RPC is issued for an unusable phone.
    expect(code.slice(normalize, rpcCall)).toContain('return { ok: false, error: "invalid_phone" }');
  });

  it("the server's own refusal is surfaced, not swallowed", () => {
    // `phone_required` is what the RPC now returns. It has to reach the member as guidance.
    expect(REGISTRATION).toContain('case "phone_required"');
  });
});

describe("7. a Google identity never satisfies the phone requirement", () => {
  it("the profile form collects the phone from the person, not from the session", () => {
    const code = stripComments(PAGE);
    // The phone state is only ever set from the input's change handler.
    const setters = code.match(/setProfilePhone\(([^)]*)\)/g) ?? [];
    expect(setters.length).toBeGreaterThan(0);
    for (const setter of setters) {
      expect(setter).toContain("e.target.value");
    }
    // And nothing reads an email/phone off the session to fill it in.
    expect(code).not.toMatch(/user_metadata[^\n]*phone/i);
    expect(code).not.toMatch(/profilePhone[^\n]*=.*\buser\b/);
  });

  it("the phone input is required, and validation does not rely on that attribute alone", () => {
    // Assert the REAL input element's attributes. The previous check sliced forward
    // from the testid and passed only because the adjacent hint sentence happened to
    // contain the word "required" — it never proved the attribute existed.
    const testidIdx = PAGE.indexOf('data-testid="loyalty-program-profile-phone"');
    expect(testidIdx).toBeGreaterThan(0);
    const inputStart = PAGE.lastIndexOf("<input", testidIdx);
    const inputEnd = PAGE.indexOf("/>", testidIdx) + 2;
    const phoneInputTag = PAGE.slice(inputStart, inputEnd);
    expect(phoneInputTag).toContain('data-testid="loyalty-program-profile-phone"');
    expect(phoneInputTag).toContain("required");
    expect(phoneInputTag).toContain('inputMode="tel"');

    // The attribute is belt; the braces are the explicit normalizer check in the handler.
    const normalizeIdx = PROFILE_STEP.indexOf("normalizeUgPhoneE164(profilePhone)");
    const submitIdx = PROFILE_STEP.indexOf("becomeLoyaltyMember(");
    expect(normalizeIdx).toBeGreaterThan(0);
    expect(submitIdx).toBeGreaterThan(normalizeIdx);
  });

  it("the value passed to the RPC is the NORMALIZED one, never the raw field", () => {
    expect(PROFILE_STEP).toContain("becomeLoyaltyMember({ displayName: profileName, phone: phoneE164 })");
  });

  it("the name is checked before the phone, and neither reaches the RPC empty", () => {
    const nameIdx = PROFILE_STEP.indexOf("profileName.trim().length < 2");
    const phoneIdx = PROFILE_STEP.indexOf("normalizeUgPhoneE164(profilePhone)");
    const submitIdx = PROFILE_STEP.indexOf("becomeLoyaltyMember(");
    expect(nameIdx).toBeGreaterThan(0);
    expect(nameIdx).toBeLessThan(phoneIdx);
    expect(phoneIdx).toBeLessThan(submitIdx);
  });

  it("both refusals set a field-level message and return before the busy state is entered", () => {
    const busyIdx = PROFILE_STEP.indexOf("setJoinBusy(true)");
    expect(busyIdx).toBeGreaterThan(0);
    // Each refusal message is produced ABOVE the busy flag — a refusal must not leave a spinner
    // running with no request in flight.
    expect(PROFILE_STEP.indexOf('t(lang, "loyaltyJoinName")')).toBeLessThan(busyIdx);
    expect(PROFILE_STEP.indexOf('t(lang, "loyaltyJoinInvalidPhone")')).toBeLessThan(busyIdx);
    // And both refusal points bail out before reaching the RPC.
    const beforeSubmit = PROFILE_STEP.slice(0, PROFILE_STEP.indexOf("becomeLoyaltyMember("));
    const returns = beforeSubmit.match(/return;/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// 8-10 / 12. The paths that must not change
// ===========================================================================

describe("8-9. an existing member is not re-created and can still join", () => {
  it("8. the page creates a profile only when the server says not_member", () => {
    // The member read decides the branch: the profile step is INVOKED from inside it, and the
    // phone field is only rendered there. Both anchors sit below the `not_member` test, so a
    // member (or a member-in-error) never reaches a registration form.
    const notMemberIdx = PAGE.indexOf('member.kind === "not_member"');
    expect(notMemberIdx).toBeGreaterThan(0);
    const callIdx = PAGE.indexOf("void createProfileThenJoin()");
    const fieldIdx = PAGE.indexOf('data-testid="loyalty-program-profile-phone"');
    expect(callIdx).toBeGreaterThan(notMemberIdx);
    expect(fieldIdx).toBeGreaterThan(notMemberIdx);
  });

  it("9. an existing member joins by code with no profile step at all", () => {
    expect(PAGE).toContain("joinLoyaltyProgramByCode(code)");
    expect(PAGE).toContain('data-testid="loyalty-program-join"');
  });

  it("10. the WPL code survives Google authentication, and only the code is stored", () => {
    expect(PAGE).toContain("storePendingProgramCode");
    const google = PAGE.slice(PAGE.indexOf("const googleSubmit"), PAGE.indexOf("const runJoin"));
    expect(google).toContain("storePendingProgramCode");
    // No identifiers travel with it.
    expect(google).not.toMatch(/shop_id|account_id|organization_id|member_id/);
  });

  it("11. the join receives the AUTHENTICATED member identity — the RPC takes only the code", () => {
    const join = read("src/lib/loyalty/loyaltyMemberJoin.ts");
    // `loyalty_member_join_by_code(p_code)`: the member is auth.uid() and the merchant is the code,
    // both resolved server-side. A client-supplied id would be an authorization hole.
    const callIdx = join.indexOf('rpc("loyalty_member_join_by_code"');
    expect(callIdx).toBeGreaterThan(0);
    const call = join.slice(callIdx, callIdx + 200);
    expect(call).toContain("p_code");
    expect(call).not.toMatch(/p_member|p_account|p_shop|p_organization/);
  });

  it("12. the anonymous path is untouched — phone still validates, merchant still approves", () => {
    const anon = PAGE.slice(PAGE.indexOf("const submit = async ()"));
    expect(anon).toContain("normalizeUgPhoneE164(phone)");
    expect(anon).toContain("submitProgramJoin");
    expect(anon).toContain("consent");
    // It still NEVER creates a member — it queues a request for a merchant to approve.
    expect(anon.slice(0, 800)).not.toMatch(/becomeLoyaltyMember|registerLoyaltyMember/);
  });
});
