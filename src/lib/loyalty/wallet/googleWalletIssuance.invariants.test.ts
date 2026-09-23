import { describe, expect, it } from "vitest";
import {
  buildGoogleLoyaltyObject,
  googleObjectId,
} from "../../../../supabase/functions/_shared/loyaltyWallet/googleWalletPass.ts";
import { deterministicGoogleWalletIds } from "../../../../supabase/functions/_shared/loyaltyWallet/googleWalletRest.ts";
import type { LoyaltyPassInput } from "../../../../supabase/functions/_shared/loyaltyWallet/walletPassTypes.ts";

/**
 * Phase 5 — issuance payload security + identity invariants.
 */

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

describe("Google Wallet issuance payload", () => {
  it("QR is only the opaque WAKA-LOYALTY token — no phone, uuid customer, or balance", () => {
    const ids = deterministicGoogleWalletIds("3388", baseInput().shopId, baseInput().accountId);
    const obj = buildGoogleLoyaltyObject(
      baseInput({ customerName: "Mama Brian", qrPayload: "WAKA-LOYALTY:opaqueTokenOnly" }),
      ids,
    );
    const raw = JSON.stringify(obj);
    expect((obj.barcode as { value: string }).value).toBe("WAKA-LOYALTY:opaqueTokenOnly");
    expect(raw).not.toMatch(/\+256|07\d{8}/);
    expect(raw).not.toContain("balancePoints");
    expect((obj.loyaltyPoints as { balance: { int: number } }).balance.int).toBe(120);
    expect(googleObjectId(ids)).toBe(`3388.acct_${baseInput().accountId}`);
  });

  it("re-issue uses the same object id (no uncontrolled duplicates)", () => {
    const shop = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const acct = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const first = deterministicGoogleWalletIds("3388", shop, acct);
    const second = deterministicGoogleWalletIds("3388", shop, acct);
    expect(googleObjectId(first)).toBe(googleObjectId(second));
  });
});
