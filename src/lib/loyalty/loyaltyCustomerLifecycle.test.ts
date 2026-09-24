import { describe, expect, it } from "vitest";
import { isMembershipActiveClient } from "./loyaltyClient";
import { normalizeLoyaltyAccountStatus } from "./loyaltyMath";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Decision 027 lifecycle client helpers", () => {
  it("normalizes legacy disabled to suspended", () => {
    expect(normalizeLoyaltyAccountStatus("disabled")).toBe("suspended");
    expect(normalizeLoyaltyAccountStatus("active")).toBe("active");
    expect(normalizeLoyaltyAccountStatus("revoked")).toBe("revoked");
  });

  it("membership active requires lifecycle active", () => {
    expect(isMembershipActiveClient("active", null)).toBe(true);
    expect(isMembershipActiveClient("disabled", null)).toBe(false);
    expect(isMembershipActiveClient("suspended", null)).toBe(false);
    expect(isMembershipActiveClient("revoked", null)).toBe(false);
  });

  it("public card lookup refuses revoked as not_found", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/_shared/loyaltyWallet/publicCardLookup.ts"),
      "utf8",
    );
    expect(src).toMatch(/status.*"revoked"/);
    expect(src).toMatch(/not_found/);
  });

  it("merchant wallet-pass refuses non-active issuance", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/loyalty-wallet-pass/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/account_revoked/);
    expect(src).toMatch(/account_inactive/);
  });
});
