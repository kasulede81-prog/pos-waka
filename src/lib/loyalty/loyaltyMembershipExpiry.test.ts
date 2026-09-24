import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafePublicCardJson } from "../../../supabase/functions/_shared/loyaltyWallet/publicCardTypes.ts";
import { isMembershipActiveClient } from "./loyaltyClient";
import { validateProgramInput, type ProgramInput } from "./loyaltyMerchant";

const BASE: ProgramInput = {
  enabled: true,
  earnUnitUgx: 1000,
  earnPointsPerUnit: 1,
  minEligibleSpendUgx: 0,
  membershipExpiryMode: "never",
  membershipFixedExpiresOn: null,
  membershipDurationMonths: null,
  pointsExpiryMode: "never",
  pointsExpiryMonths: null,
};

describe("C1 membership client helpers", () => {
  it("validateProgramInput accepts never / fixed / duration shapes", () => {
    expect(validateProgramInput(BASE)).toBeNull();
    expect(
      validateProgramInput({
        ...BASE,
        membershipExpiryMode: "fixed_date",
        membershipFixedExpiresOn: "2027-12-31",
      }),
    ).toBeNull();
    expect(
      validateProgramInput({
        ...BASE,
        membershipExpiryMode: "duration",
        membershipDurationMonths: 12,
      }),
    ).toBeNull();
    expect(
      validateProgramInput({
        ...BASE,
        membershipExpiryMode: "fixed_date",
        membershipFixedExpiresOn: null,
      }),
    ).toBe("invalid_membership_fixed_date");
    expect(
      validateProgramInput({
        ...BASE,
        membershipExpiryMode: "duration",
        membershipDurationMonths: 0,
      }),
    ).toBe("invalid_membership_duration");
  });

  it("isMembershipActiveClient treats null expiry as never-expiring", () => {
    expect(isMembershipActiveClient("active", null)).toBe(true);
    expect(isMembershipActiveClient("disabled", null)).toBe(false);
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isMembershipActiveClient("active", past)).toBe(false);
    expect(isMembershipActiveClient("active", future)).toBe(true);
  });

  it("public card safe payload allows membership fields but not private ids", () => {
    expect(() =>
      assertSafePublicCardJson({
        ok: true,
        membership_active: false,
        membership_expires_on: "2020-01-01",
        customer_name: "Amina",
        shop_name: "Kiosk",
      }),
    ).not.toThrow();
    expect(() =>
      assertSafePublicCardJson({
        ok: true,
        membership_active: true,
        account_id: "secret",
      }),
    ).toThrow(/unsafe_public_card_field/);
  });

  it("Wallet issue refuses expired membership before issuer work", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/loyalty-public-wallet-issue/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/membershipActive/);
    expect(src).toMatch(/membership_expired/);
    expect(src).not.toMatch(/validTimeInterval/);
    // Call site (not the import) must come after the membership gate.
    const gateIdx = src.indexOf('error: resolved.account.status !== "active" ? "account_inactive" : "membership_expired"');
    const callIdx = src.indexOf("await issueGoogleWalletSaveUrl(");
    expect(gateIdx).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(gateIdx);
  });
});
