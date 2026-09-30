import { describe, expect, it } from "vitest";
import { messageForProfileSaveError } from "./businessProfile";

/**
 * 4. Every failure a merchant can hit while saving their business profile has a sentence.
 *
 * The defect this pins: `messageForProfileSaveError` ended in `return codeOrMessage`, so anything
 * it did not recognise was shown to the merchant VERBATIM — `not_authorized_for_workspace`,
 * `email_not_verified`, `no_shop`, and raw PostgREST text like
 * `duplicate key value violates unique constraint "profiles_phone_e164_key"`. A shop owner cannot
 * act on any of those, and one of them ("not_authorized_for_workspace") is genuinely alarming.
 */

/** Codes the client and the RPCs can actually produce. */
const KNOWN_CODES = [
  "not_authorized_for_workspace",
  "email_not_verified",
  "no_shop",
  "save_failed",
  "unavailable",
  "timeout",
  "invalid_business_type",
  "not_authenticated",
  "unauthorized",
  "offline",
  "network",
  "phone_in_use",
  "profile_locked",
  "district_required",
  "invalid_phone",
  "shop_already_has_owner",
];

describe("4. no merchant ever reads a machine code", () => {
  it.each(KNOWN_CODES)("%s is mapped to real copy", (code) => {
    const message = messageForProfileSaveError(code, "en");
    expect(message).not.toBe(code);
    expect(message.length).toBeGreaterThan(20);
    // snake_case or SCREAMING_CASE leaking through is the thing being tested for.
    expect(message).not.toMatch(/[a-z]+_[a-z_]+/);
    expect(message).not.toMatch(/\bnull\b|\bundefined\b/);
  });

  it("an unrecognised code still gets a sentence, and is not echoed", () => {
    const message = messageForProfileSaveError("some_future_error_code", "en");
    expect(message).not.toContain("some_future_error_code");
    expect(message).toMatch(/try again|contact support/i);
  });

  it("raw PostgREST text is not echoed either", () => {
    const message = messageForProfileSaveError(
      'duplicate key value violates unique constraint "organizations_pkey"',
      "en",
    );
    expect(message).not.toContain("organizations_pkey");
    expect(message).not.toContain("duplicate key");
  });

  it("an empty or missing message is still safe", () => {
    expect(messageForProfileSaveError("", "en").length).toBeGreaterThan(20);
    expect(messageForProfileSaveError(undefined as unknown as string, "en").length).toBeGreaterThan(20);
  });

  it("each distinct cause reads differently — these are not one generic string", () => {
    const messages = new Set(
      [
        "not_authorized_for_workspace",
        "email_not_verified",
        "no_shop",
        "phone_in_use",
        "profile_locked",
        "district_required",
        "invalid_business_type",
        "unavailable",
      ].map((c) => messageForProfileSaveError(c, "en")),
    );
    expect(messages.size).toBe(8);
  });

  it("the phone-collision message is the one that names the real problem", () => {
    expect(messageForProfileSaveError("profiles_phone_e164", "en")).toMatch(
      /already on another Waka account/i,
    );
  });

  it("Luganda is served for the causes a merchant meets most often", () => {
    const lg = [
      "phone_in_use",
      "profile_locked",
      "district_required",
      "invalid_phone",
      "shop_already_has_owner",
      "no_shop",
      "not_authorized_for_workspace",
    ].map((c) => messageForProfileSaveError(c, "lg"));
    for (const m of lg) {
      expect(m).not.toMatch(/[a-z]+_[a-z_]+/);
      // "Londa ssaza." is a complete Luganda sentence in 12 characters.
      expect(m.length).toBeGreaterThan(10);
    }
    expect(new Set(lg).size).toBe(7);
  });
});
