/**
 * Loyalty wallet issuance service (Phase 06).
 *
 * Edge runtime copy: supabase/functions/_shared/loyaltyWallet/loyaltyWalletService.ts
 * Orchestrates pass issuance from a validated `LoyaltyPassInput`. All signing
 * material is injected; this module never touches secrets itself.
 */

import {
  buildApplePassJson,
  packPkpass,
} from "./appleWalletPass.ts";
import {
  buildGoogleLoyaltyClass,
  buildGoogleLoyaltyObject,
  buildGoogleSaveJwtClaims,
  buildGoogleWalletSaveUrl,
  type GoogleIds,
} from "./googleWalletPass.ts";
import type {
  ApplePassSigner,
  GoogleWalletSigner,
  IssuedWalletPass,
  LoyaltyPassInput,
  WalletIssueResult,
} from "./walletPassTypes.ts";

export function validatePassInput(input: LoyaltyPassInput): string | null {
  if (!input.shopId.trim()) return "shop_id_required";
  if (!input.accountId.trim()) return "account_id_required";
  if (!input.customerName.trim()) return "customer_name_required";
  if (!input.qrToken.trim()) return "qr_token_required";
  if (!input.qrPayload.trim()) return "qr_payload_required";
  if (!Number.isFinite(input.balancePoints) || input.balancePoints < 0) return "invalid_balance";
  return null;
}

export type AppleWalletConfig = {
  passTypeIdentifier: string;
  teamIdentifier: string;
};

export async function issueAppleWalletPass(
  input: LoyaltyPassInput,
  config: AppleWalletConfig,
  signer: ApplePassSigner,
): Promise<WalletIssueResult> {
  const invalid = validatePassInput(input);
  if (invalid) return { ok: false, error: "invalid_input" };
  if (!config.passTypeIdentifier.trim() || !config.teamIdentifier.trim()) {
    return { ok: false, error: "wallet_not_configured" };
  }
  try {
    const passJson = buildApplePassJson(input, {
      passTypeIdentifier: config.passTypeIdentifier,
      teamIdentifier: config.teamIdentifier,
      serialNumber: input.accountId,
    });
    const { pkpass } = await packPkpass({ passJson }, signer);
    const pass: IssuedWalletPass = {
      provider: "apple_wallet",
      pkpass,
      filename: `waka-loyalty-${input.accountId}.pkpass`,
    };
    return { ok: true, pass };
  } catch {
    return { ok: false, error: "signing_failed" };
  }
}

export type GoogleWalletConfig = {
  ids: GoogleIds;
  origins: string[];
};

export async function issueGoogleWalletSaveUrl(
  input: LoyaltyPassInput,
  config: GoogleWalletConfig,
  signer: GoogleWalletSigner,
  nowSeconds: number,
): Promise<WalletIssueResult> {
  const invalid = validatePassInput(input);
  if (invalid) return { ok: false, error: "invalid_input" };
  if (!config.ids.issuerId.trim()) return { ok: false, error: "wallet_not_configured" };
  try {
    const loyaltyClass = buildGoogleLoyaltyClass(input, config.ids);
    const loyaltyObject = buildGoogleLoyaltyObject(input, config.ids);
    const claims = buildGoogleSaveJwtClaims(
      signer,
      loyaltyClass,
      loyaltyObject,
      config.origins,
      nowSeconds,
    );
    const saveUrl = await buildGoogleWalletSaveUrl(signer, claims);
    return { ok: true, pass: { provider: "google_wallet", saveUrl } };
  } catch {
    return { ok: false, error: "signing_failed" };
  }
}
