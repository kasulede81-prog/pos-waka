import { describe, expect, it } from "vitest";
import {
  issueAppleWalletPass,
  issueGoogleWalletSaveUrl,
  validatePassInput,
} from "../../../../supabase/functions/_shared/loyaltyWallet/loyaltyWalletService.ts";
import type {
  ApplePassSigner,
  GoogleWalletSigner,
  LoyaltyPassInput,
} from "../../../../supabase/functions/_shared/loyaltyWallet/walletPassTypes.ts";

/**
 * Phase 06 — Wallet issuance service: input validation, configuration
 * availability (missing credentials must fail closed), and end-to-end
 * issuance with stub signers (real signers tested in the provider suites).
 */

const INPUT: LoyaltyPassInput = {
  shopId: "shop-1",
  shopName: "Kampala Kiosk",
  accountId: "acct-1",
  customerName: "Mama Brian",
  qrToken: "tok123opaque",
  qrPayload: "WAKA-LOYALTY:tok123opaque",
  balancePoints: 42,
  programLabel: "1 pt per UGX 1,000 spent",
};

const STUB_APPLE_SIGNER: ApplePassSigner = {
  async signManifest(bytes) {
    return new Uint8Array([0x30, bytes.length & 0xff]);
  },
};

const STUB_GOOGLE_SIGNER: GoogleWalletSigner = {
  serviceAccountEmail: "wallet@waka.iam.gserviceaccount.com",
  async signJwt() {
    return "h.p.s";
  },
};

describe("validatePassInput", () => {
  it("accepts a complete input", () => {
    expect(validatePassInput(INPUT)).toBeNull();
  });

  it("rejects missing identity fields", () => {
    expect(validatePassInput({ ...INPUT, customerName: "" })).toBe("customer_name_required");
    expect(validatePassInput({ ...INPUT, qrToken: "" })).toBe("qr_token_required");
    expect(validatePassInput({ ...INPUT, qrPayload: "" })).toBe("qr_payload_required");
    expect(validatePassInput({ ...INPUT, accountId: "" })).toBe("account_id_required");
  });

  it("rejects negative or non-finite balances", () => {
    expect(validatePassInput({ ...INPUT, balancePoints: -1 })).toBe("invalid_balance");
    expect(validatePassInput({ ...INPUT, balancePoints: Number.NaN })).toBe("invalid_balance");
  });
});

describe("issueAppleWalletPass", () => {
  it("fails closed when pass identifiers are not configured", async () => {
    const result = await issueAppleWalletPass(
      INPUT,
      { passTypeIdentifier: "", teamIdentifier: "" },
      STUB_APPLE_SIGNER,
    );
    expect(result).toEqual({ ok: false, error: "wallet_not_configured" });
  });

  it("rejects invalid input before touching the signer", async () => {
    let signed = false;
    const result = await issueAppleWalletPass(
      { ...INPUT, customerName: "" },
      { passTypeIdentifier: "pass.com.waka.pos", teamIdentifier: "TEAM1" },
      {
        async signManifest() {
          signed = true;
          return new Uint8Array([1]);
        },
      },
    );
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(signed).toBe(false);
  });

  it("issues a pkpass with a deterministic filename", async () => {
    const result = await issueAppleWalletPass(
      INPUT,
      { passTypeIdentifier: "pass.com.waka.pos", teamIdentifier: "TEAM1" },
      STUB_APPLE_SIGNER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pass.provider).toBe("apple_wallet");
    if (result.pass.provider !== "apple_wallet") return;
    expect(result.pass.filename).toBe("waka-loyalty-acct-1.pkpass");
    expect(result.pass.pkpass.length).toBeGreaterThan(100);
  });
});

describe("issueGoogleWalletSaveUrl", () => {
  it("fails closed when the issuer id is not configured", async () => {
    const result = await issueGoogleWalletSaveUrl(
      INPUT,
      { ids: { issuerId: "", classId: "c", objectId: "o" }, origins: [] },
      STUB_GOOGLE_SIGNER,
      1_700_000_000,
    );
    expect(result).toEqual({ ok: false, error: "wallet_not_configured" });
  });

  it("issues a save URL via the injected signer", async () => {
    const result = await issueGoogleWalletSaveUrl(
      INPUT,
      {
        ids: { issuerId: "3388000000000000001", classId: "waka_loyalty", objectId: "acct-1" },
        origins: ["https://waka.example"],
        persistObjects: false,
      },
      STUB_GOOGLE_SIGNER,
      1_700_000_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pass.provider).toBe("google_wallet");
    if (result.pass.provider !== "google_wallet") return;
    expect(result.pass.saveUrl.startsWith("https://pay.google.com/gp/v/save/")).toBe(true);
  });

  it("still returns a Save URL when REST class upsert is denied (API not enabled)", async () => {
    const fetchImpl = async (url: string, _init?: { method?: string; body?: string }) => {
      if (url.includes("oauth2.googleapis.com")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }),
        };
      }
      // Simulate accessNotConfigured on Wallet Objects API
      return {
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            error: {
              code: 403,
              status: "PERMISSION_DENIED",
              message: "Google Wallet API has not been used in project before",
              errors: [{ reason: "accessNotConfigured" }],
            },
          }),
      };
    };
    const result = await issueGoogleWalletSaveUrl(
      INPUT,
      {
        ids: { issuerId: "3388000000000000001", classId: "waka_loyalty", objectId: "acct-1" },
        origins: ["https://waka.example"],
        persistObjects: true,
        fetchImpl,
      },
      STUB_GOOGLE_SIGNER,
      1_700_000_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pass.provider).toBe("google_wallet");
    if (result.pass.provider !== "google_wallet") return;
    expect(result.pass.saveUrl.startsWith("https://pay.google.com/gp/v/save/")).toBe(true);
  });
});
