/**
 * Lightweight shape tests for the public loyalty Edge responses.
 * Full Deno edge runtime is not executed here — these lock the contract.
 */

import { describe, expect, it } from "vitest";
import {
  assertSafePublicCardJson,
  encodeLoyaltyQrPayload,
  isValidPublicCardTokenFormat,
} from "../../../supabase/functions/_shared/loyaltyWallet/publicCardTypes.ts";

describe("loyalty-public-card response contract", () => {
  it("documents the allowed public JSON shape", () => {
    const body = {
      ok: true as const,
      customer_name: "Amina",
      shop_name: "Kampala Kiosk",
      program_name: "Kampala Kiosk Loyalty",
      balance_points: 42,
      account_active: true,
      program_enabled: true,
      qr_payload: encodeLoyaltyQrPayload("qr-token-1"),
      rewards: [{ name: "Free tea", points_required: 20, description: "Hot" }],
      wallet_configured: true,
    };
    expect(body.qr_payload).toBe("WAKA-LOYALTY:qr-token-1");
    expect(() => assertSafePublicCardJson(body)).not.toThrow();
    expect(JSON.stringify(body)).not.toMatch(/phone|email|account_id|shop_id|customer_id/i);
  });

  it("rejects client-supplied shop authority patterns in token validation", () => {
    // Tokens must be opaque hex — shop UUIDs / phones never qualify.
    expect(isValidPublicCardTokenFormat("256700000001")).toBe(false);
    expect(isValidPublicCardTokenFormat("00000000-0000-0000-0000-000000000001")).toBe(false);
  });
});

describe("loyalty-public-wallet-issue authority", () => {
  it("only accepts public_card_token format — not account_id or shop_id", () => {
    expect(isValidPublicCardTokenFormat("a".repeat(64))).toBe(true);
    expect(isValidPublicCardTokenFormat("acct_123")).toBe(false);
    expect(isValidPublicCardTokenFormat("shop_123")).toBe(false);
  });
});
