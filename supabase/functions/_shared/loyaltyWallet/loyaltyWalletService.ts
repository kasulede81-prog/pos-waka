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
import {
  fetchGoogleWalletAccessToken,
  patchGoogleLoyaltyObjectBalance,
  upsertGoogleLoyaltyClass,
  upsertGoogleLoyaltyObject,
  type FetchLike,
} from "./googleWalletRest.ts";
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
  /**
   * When true (default for live issuance), upsert the LoyaltyObject via REST
   * before returning the Save URL so later balance PATCHes have a real object.
   * JWT-only mode remains available for unit tests without network.
   */
  persistObjects?: boolean;
  /**
   * When true, embed loyaltyClasses in the Save JWT (bootstrap / unpublished).
   * Default false: production uses the published class
   * `{issuerId}.waka_loyalty` and JWT carries objects only.
   */
  includeLoyaltyClassInJwt?: boolean;
  /**
   * When true (default), skip LoyaltyClass REST upsert — the published class
   * must not be overwritten with reviewStatus UNDER_REVIEW.
   */
  skipClassUpsert?: boolean;
  fetchImpl?: FetchLike;
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
  if (!config.ids.classId.trim()) return { ok: false, error: "wallet_not_configured" };
  try {
    const loyaltyClass = buildGoogleLoyaltyClass(input, config.ids);
    const loyaltyObject = buildGoogleLoyaltyObject(input, config.ids);

    // REST object upsert is best-effort. Class upsert is skipped by default so we
    // never overwrite the published ACTIVE `waka_loyalty` class.
    if (config.persistObjects !== false) {
      try {
        const token = await fetchGoogleWalletAccessToken(signer, nowSeconds, config.fetchImpl);
        const skipClass = config.skipClassUpsert !== false;
        if (!skipClass) {
          const classResult = await upsertGoogleLoyaltyClass(
            token.accessToken,
            loyaltyClass,
            config.fetchImpl,
          );
          console.log(
            JSON.stringify({
              event: "google_wallet_class_upsert",
              ok: classResult.ok,
              status: classResult.status,
              created: classResult.created,
              google_status: classResult.googleStatus ?? null,
              google_reason: classResult.googleReason ?? null,
              google_message: classResult.googleMessage ?? null,
            }),
          );
        }
        const objectResult = await upsertGoogleLoyaltyObject(
          token.accessToken,
          loyaltyObject,
          config.fetchImpl,
        );
        console.log(
          JSON.stringify({
            event: "google_wallet_object_upsert",
            ok: objectResult.ok,
            status: objectResult.status,
            created: objectResult.created,
            google_status: objectResult.googleStatus ?? null,
            google_reason: objectResult.googleReason ?? null,
            google_message: objectResult.googleMessage ?? null,
          }),
        );
      } catch (persistErr) {
        console.log(
          JSON.stringify({
            event: "google_wallet_persist_skipped",
            reason: persistErr instanceof Error ? persistErr.message.slice(0, 120) : "persist_error",
          }),
        );
      }
    }

    const claims = buildGoogleSaveJwtClaims(
      signer,
      loyaltyClass,
      loyaltyObject,
      config.origins,
      nowSeconds,
      { includeLoyaltyClass: config.includeLoyaltyClassInJwt === true },
    );
    const saveUrl = await buildGoogleWalletSaveUrl(signer, claims);
    return { ok: true, pass: { provider: "google_wallet", saveUrl } };
  } catch {
    return { ok: false, error: "signing_failed" };
  }
}

/**
 * Push the authoritative loyalty balance to an existing Google Wallet object.
 * Failures are returned — callers must never roll back sales/ledger because of this.
 */
export async function syncGoogleWalletObjectBalance(
  ids: GoogleIds,
  balancePoints: number,
  signer: GoogleWalletSigner,
  nowSeconds: number,
  fetchImpl?: FetchLike,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  if (!ids.issuerId.trim() || !ids.objectId.trim()) {
    return { ok: false, error: "wallet_not_configured" };
  }
  if (!Number.isFinite(balancePoints) || balancePoints < 0) {
    return { ok: false, error: "invalid_balance" };
  }
  try {
    const token = await fetchGoogleWalletAccessToken(signer, nowSeconds, fetchImpl);
    const result = await patchGoogleLoyaltyObjectBalance(
      token.accessToken,
      ids,
      balancePoints,
      fetchImpl,
    );
    if (!result.ok) return { ok: false, error: "wallet_sync_failed", status: result.status };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "wallet_sync_failed" };
  }
}
