import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const PAGE = "src/pages/ShopOnboardingPage.tsx";

/**
 * THE PHONE TRAP, AT THE LEVEL IT ACTUALLY HAPPENED.
 *
 * The location step validated for a phone number and rendered no field to type one into. A Google
 * merchant — whose identity carries no phone — resolved "no phone", was told "Teekawo namba
 * entuufu", and had "Skip for now" as the only way forward, which ran the same check and produced
 * the same message. Every refresh returned them to the same screen.
 *
 * There is no DOM test project in this repository (the vitest environments are `node`, and no
 * renderer is installed), so the RENDERED STEP is asserted the way the rest of the suite asserts
 * UI structure: by reading the component and the strings it uses. The behaviour of the rule itself
 * is asserted for real in `src/lib/onboardingContact.test.ts`, and the database contract in
 * `src/lib/merchantRegistrationResume.sql.integration.test.ts`.
 */

/**
 * Strip comments, because these tests ask what the step RENDERS. A comment that names a bad label
 * (to explain why it is bad) is not a control the merchant can tap, and a scan that cannot tell
 * the two apart would forbid documenting the very mistake it is guarding against.
 */
function withoutComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The location step's own JSX, so a field elsewhere in the wizard cannot satisfy these tests. */
function locationStep(): string {
  const file = src(PAGE);
  const start = file.indexOf('{!booting && step === "location" ? (');
  const end = file.indexOf('{!booting && step === "products" ? (');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return withoutComments(file.slice(start, end));
}

describe("E. the phone field is actually rendered in the location step", () => {
  it("the step renders a phone input", () => {
    const step = locationStep();
    expect(step).toContain("registerPhoneLabel");
    expect(step).toContain('type="tel"');
    expect(step).toContain('inputMode="tel"');
    expect(step).toContain('autoComplete="tel"');
  });

  it("it is bound to the same state the save reads", () => {
    const step = locationStep();
    // Value and onChange both on `phoneInput` — the state `resolveOnboardingPhone` consults first.
    expect(step).toContain("value={phoneInput}");
    expect(step).toContain("setPhoneInput(e.target.value)");
    expect(src(PAGE)).toContain("typed: phoneInput");
  });

  it("it is tappable on iOS: rendered through BuilderField from a real label", () => {
    // BuilderField wraps the control in a <label>, so tapping the label focuses the input and the
    // iOS keyboard opens. The step must not hand-roll a bare <input> that loses that.
    expect(locationStep()).toMatch(/<BuilderField\b/);
    const field = src("src/components/businessBuilder/BuilderField.tsx");
    expect(field).toContain("<label");
    expect(field).toContain("<input");
  });

  it("the phone field is NOT conditional on already having a phone", () => {
    const step = locationStep();
    // The trap was a field that only existed when the value was already known. The phone
    // BuilderField must sit outside the `contactFromSignup` branch that the district uses.
    const phoneAt = step.indexOf("registerPhoneLabel");
    const branchAt = step.indexOf("contactFromSignup && districtLabel");
    expect(phoneAt).toBeGreaterThan(-1);
    expect(branchAt).toBeGreaterThan(phoneAt);
  });
});

describe("F, H. the refusal is shown beside the field it is about", () => {
  it("phone and district failures are field-level, never the step's general error slot", () => {
    const page = src(PAGE);
    expect(page).toContain("setPhoneError(t(lang, problem.messageKey))");
    expect(page).toContain("setDistrictError(t(lang, problem.messageKey))");
    // The old code routed both into `setErr`, which rendered below the district with no indication
    // of which field was wrong — and, for the phone, no field to fix at all.
    expect(page).not.toContain('setErr(t(lang, "registerPhoneInvalid"))');
    expect(page).not.toContain('setErr(t(lang, "businessProfileDistrictRequired"))');
  });

  it("each error is rendered on its own control", () => {
    const step = locationStep();
    expect(step).toContain("error={phoneError}");
    expect(step).toContain("error={districtError}");
  });

  it("editing a field clears that field's error and no other", () => {
    const step = locationStep();
    expect(step).toContain("setPhoneError(null)");
    expect(step).toContain("setDistrictError(null)");
  });

  it("the phone error is cleared on entry into the step, so a stale refusal cannot block", () => {
    expect(src(PAGE)).toMatch(/setPhoneError\(null\);\s*\n\s*setDistrictError\(null\);/);
  });
});

describe("I. the wording matches the contract", () => {
  it("the step no longer calls the district optional", () => {
    const dict = src("src/lib/i18n.ts");
    expect(dict).not.toContain('"Optional — helps field support find you."');
    // It now says what is actually required, in the same sentence the merchant reads first.
    expect(dict).toMatch(/onboardLocSub:\s*\n\s*"Your district and mobile number are needed/);
  });

  it("both fields are marked required in the step", () => {
    const step = locationStep();
    expect(step).toContain('label={`${t(lang, "registerPhoneLabel")} *`}');
    expect(step).toContain('label={`${t(lang, "registerDistrictLabel")} *`}');
  });

  it("the district select is still required — it was never optional", () => {
    const step = locationStep();
    expect(step).toMatch(/as="select"[\s\S]*?required/);
  });

  it("an empty phone gets its own message rather than 'enter a valid number'", () => {
    expect(src("src/lib/i18n.ts")).toContain("onboardLocPhoneRequired:");
  });
});

/**
 * GPS IS OPTIONAL. THE DISTRICT AND THE MOBILE NUMBER ARE NOT.
 *
 * The step offers one way to proceed without location permission, and it used to be labelled
 * "Skip for now" — which promised an exit that the validation then refused. A merchant tapped it,
 * was told their phone number was wrong, and had no way to read that as anything but "this step is
 * broken". The label now names the only thing being skipped, and these tests hold the distinction:
 * the button skips GPS and nothing else, and it takes the same validated path as "Continue".
 */
describe("GPS is optional; phone and district are not", () => {
  const DICT = "src/lib/i18n.ts";

  it("the step offers no action that reads as skipping the profile", () => {
    const step = locationStep();
    expect(step).not.toContain("onboardLocSkip");
    expect(step).not.toContain('"Skip for now"');
    // And the key itself is gone, so the old framing cannot be reintroduced by a lookup.
    expect(src(DICT)).not.toContain("onboardLocSkip:");
    expect(src(DICT)).not.toContain("onboardLocSkip =");
  });

  it("the skip action is named for GPS, the one thing it actually skips", () => {
    expect(src(DICT)).toContain('onboardLocContinueWithoutGps: "Continue without GPS"');
    expect(locationStep()).toContain("onboardLocContinueWithoutGps");
  });

  it("'Use my location' remains available alongside it", () => {
    const step = locationStep();
    expect(step).toContain("onboardLocUse");
    expect(step).toContain("captureLocation");
  });

  it("it clears ONLY the GPS pin — never the phone or the district", () => {
    const step = locationStep();
    const start = step.indexOf("onboardLocContinueWithoutGps");
    // The handler is the onClick immediately preceding the label.
    const handler = step.slice(step.lastIndexOf("onClick", start), start);
    expect(handler).toContain("setGpsSkipped(true)");
    expect(handler).toContain("setLat(undefined)");
    expect(handler).toContain("setLng(undefined)");
    expect(handler).not.toContain("setPhoneInput");
    expect(handler).not.toContain("setDistrictId");
    expect(handler).not.toContain("setPhoneError(null)");
    expect(handler).not.toContain("setDistrictError(null)");
  });

  it("it takes the SAME validated path as Continue — no unvalidated exit from the step", () => {
    const step = locationStep();
    const start = step.indexOf("onboardLocContinueWithoutGps");
    const handler = step.slice(step.lastIndexOf("onClick", start), start);
    expect(handler).toContain("advanceAfterLocation()");

    // …and that path is the one that validates.
    const page = src(PAGE);
    expect(page).toMatch(
      /const advanceAfterLocation = async \(\) => \{\s*const ok = await finishCore\(/,
    );

    // Every forward action in the step routes through it: the GPS button only captures, it never
    // advances on its own.
    const advanceCalls = step.match(/advanceAfterLocation\(\)/g) ?? [];
    expect(advanceCalls.length).toBeGreaterThanOrEqual(2); // without-GPS, and Continue-after-GPS
    const captureHandler = step.slice(
      step.lastIndexOf("onClick", step.indexOf("captureLocation")),
      step.indexOf("captureLocation", step.lastIndexOf("onClick", step.indexOf("captureLocation"))),
    );
    expect(captureHandler).not.toContain("advanceAfterLocation");
  });

  it("the step's own words say which of the three is optional", () => {
    const dict = src(DICT);
    expect(dict).toContain(
      "Your district and mobile number are needed to finish setting up your shop. GPS is optional.",
    );
  });
});

describe("J. completing the profile updates the existing workspace", () => {
  it("the step saves through the shared persist, which calls the bundle save", () => {
    // The step's buttons hand off to `finishCore`, which is where the save lives — so the step
    // must reach it, and `finishCore` must be the thing that calls the shared persist.
    expect(locationStep()).toContain("advanceAfterLocation");
    expect(src(PAGE)).toContain("persistOnboardingChoices");
    const persist = src("src/lib/shopOnboardingPersist.ts");
    // The bundle RPC resolves the caller's existing shop by membership and updates it; it only
    // ever creates when there is nothing to update. Asserted at the database level in
    // `merchantRegistrationResume.sql.integration.test.ts`.
    expect(persist).toContain("saveOwnerBusinessProfileBundleRpc");
    expect(persist).toContain("completeShopOnboardingWizard");
  });

  it("the wizard marks completion only after the cloud save has been accepted", () => {
    const persist = src("src/lib/shopOnboardingPersist.ts");
    const saveAt = persist.indexOf("saveOwnerBusinessProfileBundleRpc");
    const completeAt = persist.indexOf("completeShopOnboardingWizard");
    expect(saveAt).toBeGreaterThan(-1);
    expect(completeAt).toBeGreaterThan(saveAt);
  });
});
