import { describe, expect, it } from "vitest";
import {
  buildGoogleLoyaltyObject,
  buildGoogleSaveJwtClaims,
  googleClassId,
  googleObjectId,
} from "../../../../supabase/functions/_shared/loyaltyWallet/googleWalletPass.ts";
import {
  deterministicGoogleWalletIds,
  GOOGLE_WALLET_PUBLISHED_CLASS_SUFFIX,
} from "../../../../supabase/functions/_shared/loyaltyWallet/googleWalletRest.ts";
import type { LoyaltyPassInput } from "../../../../supabase/functions/_shared/loyaltyWallet/walletPassTypes.ts";

/**
 * Production Google Wallet issuance invariants.
 * Issuer 338800000023208320 / class waka_loyalty is published ACTIVE.
 */

const PROD_ISSUER = "338800000023208320";

const baseInput = (over: Partial<LoyaltyPassInput> = {}): LoyaltyPassInput => ({
  shopId: "11111111-1111-1111-1111-111111111111",
  shopName: "Shop A",
  accountId: "22222222-2222-2222-2222-222222222222",
  customerName: "Mama Brian",
  qrToken: "opaqueTokenOnly",
  qrPayload: "WAKA-LOYALTY:opaqueTokenOnly",
  balancePoints: 120,
  programLabel: "1 pt / 1000",
  ...over,
});

describe("Google Wallet production class/object ids", () => {
  it("uses shared published class suffix waka_loyalty (not per-shop)", () => {
    const shopA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const shopB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const acct = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const a = deterministicGoogleWalletIds(PROD_ISSUER, shopA, acct);
    const b = deterministicGoogleWalletIds(PROD_ISSUER, shopB, acct);
    expect(a.classId).toBe(GOOGLE_WALLET_PUBLISHED_CLASS_SUFFIX);
    expect(b.classId).toBe(GOOGLE_WALLET_PUBLISHED_CLASS_SUFFIX);
    expect(googleClassId(a)).toBe(`${PROD_ISSUER}.waka_loyalty`);
    expect(googleClassId(b)).toBe(`${PROD_ISSUER}.waka_loyalty`);
    expect(googleObjectId(a)).toBe(`${PROD_ISSUER}.acct_${acct}`);
    expect(a.classId).toBe(b.classId);
  });

  it("Save JWT references existing class via object.classId only", () => {
    const ids = deterministicGoogleWalletIds(PROD_ISSUER, baseInput().shopId, baseInput().accountId);
    const obj = buildGoogleLoyaltyObject(baseInput(), ids);
    expect(obj.classId).toBe(`${PROD_ISSUER}.waka_loyalty`);
    expect(obj.id).toBe(`${PROD_ISSUER}.acct_${baseInput().accountId}`);
    expect(obj.state).toBe("ACTIVE");

    const claims = buildGoogleSaveJwtClaims(
      { serviceAccountEmail: "sa@waka.iam.gserviceaccount.com" },
      { id: googleClassId(ids) },
      obj,
      ["https://pos.waka.ug", "https://loyalty.waka.ug"],
      1_700_000_000,
    );
    expect(claims.aud).toBe("google");
    expect(claims.typ).toBe("savetowallet");
    expect(claims.iat).toBe(1_700_000_000);
    expect(claims).not.toHaveProperty("exp");
    expect(claims.origins).toEqual(["https://pos.waka.ug", "https://loyalty.waka.ug"]);
    expect(claims.payload.loyaltyClasses).toBeUndefined();
    expect(claims.payload.loyaltyObjects).toHaveLength(1);
    expect((claims.payload.loyaltyObjects[0] as { classId: string }).classId).toBe(
      `${PROD_ISSUER}.waka_loyalty`,
    );
    expect((claims.payload.loyaltyObjects[0] as { id: string }).id.startsWith(`${PROD_ISSUER}.`)).toBe(
      true,
    );
  });

  it("QR is only the opaque WAKA-LOYALTY token — no phone", () => {
    const ids = deterministicGoogleWalletIds(PROD_ISSUER, baseInput().shopId, baseInput().accountId);
    const obj = buildGoogleLoyaltyObject(
      baseInput({ customerName: "Mama Brian", qrPayload: "WAKA-LOYALTY:opaqueTokenOnly" }),
      ids,
    );
    const raw = JSON.stringify(obj);
    expect((obj.barcode as { value: string }).value).toBe("WAKA-LOYALTY:opaqueTokenOnly");
    expect(raw).not.toMatch(/\+256|07\d{8}/);
    expect((obj.loyaltyPoints as { balance: { int: number } }).balance.int).toBe(120);
  });

  it("re-issue uses the same object id (no uncontrolled duplicates)", () => {
    const shop = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const acct = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const first = deterministicGoogleWalletIds(PROD_ISSUER, shop, acct);
    const second = deterministicGoogleWalletIds(PROD_ISSUER, shop, acct);
    expect(googleObjectId(first)).toBe(googleObjectId(second));
  });
});
