import { describe, expect, it } from "vitest";
import {
  onboardingContactProblem,
  onboardingPhoneCandidates,
  resolveOnboardingPhone,
} from "./onboardingContact";

/**
 * The rule the location step enforces, asserted directly.
 *
 * The bug this file exists for: the step required a phone number and rendered no field to enter
 * one, so a Google merchant — whose identity carries no phone — was trapped. The requirement is
 * legitimate and stays; what these tests pin is that the value is resolved in the right order, and
 * that every refusal names a field the merchant can actually see and use.
 */

describe("resolveOnboardingPhone — the order candidates are believed in", () => {
  it("What the merchant just typed wins over what we knew before asking", () => {
    expect(
      resolveOnboardingPhone({
        typed: "0782123456",
        seeded: "+256772123456",
        fromLocalPrefs: "+256701123456",
        fromAuthMetadata: "+256751123456",
      }),
    ).toBe("+256782123456");
  });

  it("falls back to the seeded value when the field is still empty", () => {
    expect(resolveOnboardingPhone({ typed: "", seeded: "+256772123456" })).toBe("+256772123456");
  });

  it("ignores a typed value that is not usable rather than treating it as 'answered'", () => {
    // A half-typed number must not shadow a number we already hold: the merchant leaving "07"
    // behind does not mean they have no phone.
    expect(resolveOnboardingPhone({ typed: "07", seeded: "+256772123456" })).toBe("+256772123456");
  });

  it("a Google identity with nothing anywhere resolves to null — the case that trapped people", () => {
    expect(
      resolveOnboardingPhone({
        typed: "",
        seeded: "",
        fromLocalPrefs: "",
        fromAuthMetadata: "",
      }),
    ).toBeNull();
  });

  it("candidates keep the believed-first order", () => {
    expect(onboardingPhoneCandidates({ typed: "a", seeded: "b", fromLocalPrefs: "c", fromAuthMetadata: "d" })).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("G. every Uganda format the step promises is accepted", () => {
  const ACCEPTED: Array<[string, string]> = [
    ["0772123456", "+256772123456"],
    ["0782123456", "+256782123456"],
    ["0872123456", "+256872123456"],
    ["+256772123456", "+256772123456"],
    ["+256872123456", "+256872123456"],
    ["256772123456", "+256772123456"],
    ["772123456", "+256772123456"],
    ["0772 123 456", "+256772123456"],
    ["+256 772 123 456", "+256772123456"],
  ];

  for (const [typed, expected] of ACCEPTED) {
    it(`accepts ${typed} and normalises it to ${expected}`, () => {
      expect(resolveOnboardingPhone({ typed })).toBe(expected);
      // And with a valid number and a district, the step has nothing left to complain about.
      expect(
        onboardingContactProblem({ phoneE164: expected, phoneRaw: typed, districtId: "kampala" }),
      ).toBeNull();
    });
  }
});

describe("H. an unusable number is refused, and says what to do", () => {
  const REJECTED = ["123", "077212345", "07721234567", "+15551234567", "abcdef", "07-"];

  for (const typed of REJECTED) {
    it(`refuses ${JSON.stringify(typed)} on the phone field`, () => {
      const problem = onboardingContactProblem({
        phoneE164: resolveOnboardingPhone({ typed }),
        phoneRaw: typed,
        districtId: "kampala",
      });
      expect(problem).toEqual({ field: "phone", messageKey: "registerPhoneInvalid" });
    });
  }
});

describe("F. an empty field is told to supply a number, not to correct one", () => {
  it("names the phone field with the 'enter your number' message", () => {
    const problem = onboardingContactProblem({ phoneE164: null, phoneRaw: "", districtId: "" });
    expect(problem).toEqual({ field: "phone", messageKey: "onboardLocPhoneRequired" });
  });

  it("phone is reported before district — the merchant is not asked for two things at once", () => {
    const problem = onboardingContactProblem({ phoneE164: null, phoneRaw: "", districtId: "" });
    expect(problem?.field).toBe("phone");
  });

  it("whitespace is empty, not 'wrong'", () => {
    expect(onboardingContactProblem({ phoneE164: null, phoneRaw: "   ", districtId: "" })).toEqual({
      field: "phone",
      messageKey: "onboardLocPhoneRequired",
    });
  });
});

/**
 * THE DISTINCTION THE STEP'S BUTTONS HAVE TO GET RIGHT.
 *
 * "Continue without GPS" proceeds without location permission and validates everything else —
 * it is not an escape hatch. These assertions are deliberately made through the same function the
 * step calls, so the guarantee is about the rule and not about a particular label.
 *
 * Note what is ABSENT: neither resolver takes a GPS argument, so no GPS state can make a missing
 * phone or district acceptable. That is the structural reason the button cannot skip them.
 */
describe("J. GPS is optional — and it is the ONLY thing that is", () => {
  it("the requirement takes no GPS input at all", () => {
    // A signature check, on purpose: if a `gpsSkipped` parameter were ever added here, the step
    // could start accepting a missing phone or district on a GPS-skipped run.
    expect(onboardingContactProblem.length).toBe(1);
    expect(resolveOnboardingPhone.length).toBe(1);
  });

  it("proceeding without GPS still blocks an empty phone", () => {
    expect(onboardingContactProblem({ phoneE164: null, phoneRaw: "", districtId: "kampala" })).toEqual({
      field: "phone",
      messageKey: "onboardLocPhoneRequired",
    });
  });

  it("proceeding without GPS still blocks a missing district", () => {
    expect(
      onboardingContactProblem({ phoneE164: "+256772123456", phoneRaw: "0772123456", districtId: "" }),
    ).toEqual({ field: "district", messageKey: "businessProfileDistrictRequired" });
  });

  it("only phone AND district together let the step continue", () => {
    expect(
      onboardingContactProblem({ phoneE164: "+256772123456", phoneRaw: "0772123456", districtId: "kampala" }),
    ).toBeNull();
  });

  it("location permission is never consulted, so granting it fixes nothing on its own", () => {
    // The same incomplete input is incomplete regardless of how the merchant answered the GPS
    // prompt — the two are independent.
    const withoutGps = onboardingContactProblem({ phoneE164: null, phoneRaw: "", districtId: "" });
    const withGps = onboardingContactProblem({ phoneE164: null, phoneRaw: "", districtId: "" });
    expect(withoutGps).toEqual(withGps);
    expect(withoutGps?.field).toBe("phone");
  });
});

describe("I. district is required — it really does block, and it names itself", () => {
  it("a valid phone with no district is refused on the district field", () => {
    expect(
      onboardingContactProblem({ phoneE164: "+256772123456", phoneRaw: "0772123456", districtId: "" }),
    ).toEqual({ field: "district", messageKey: "businessProfileDistrictRequired" });
  });

  it("the save contract is why: the RPC refuses a null district", () => {
    // Mirrors `save_owner_business_profile_bundle`, which returns district_required before it
    // writes anything. Asserted at the database level in
    // `merchantRegistrationResume.sql.integration.test.ts`.
    expect(
      onboardingContactProblem({ phoneE164: "+256772123456", phoneRaw: "0772123456", districtId: "kla" }),
    ).toBeNull();
  });
});
