import { describe, expect, it } from "vitest";
import { googleWalletEnvLooksConfigured } from "../../../../supabase/functions/_shared/loyaltyWallet/googleWalletConfiguredCheck.ts";

/**
 * W1 — public card GET must not construct an RSA signer / parse PEM merely
 * to answer wallet_configured. The cheap helper only checks string presence.
 */

describe("googleWalletEnvLooksConfigured (W1)", () => {
  it("returns false when issuer or JSON missing", () => {
    expect(googleWalletEnvLooksConfigured("", '{"client_email":"a","private_key":"b"}')).toBe(false);
    expect(googleWalletEnvLooksConfigured("issuer", "")).toBe(false);
  });

  it("returns true when key field names are present without validating PEM", () => {
    const junk = '{"client_email":"not-an-email","private_key":"NOT_A_PEM"}';
    expect(googleWalletEnvLooksConfigured("issuer-1", junk)).toBe(true);
  });

  it("returns false when required JSON keys are absent", () => {
    expect(googleWalletEnvLooksConfigured("issuer-1", '{"type":"service_account"}')).toBe(false);
  });
});
