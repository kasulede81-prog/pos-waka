/**
 * Premium card banner. Served from the app's own `public/` directory — the same origin the
 * logo already uses — so it needs no extra hosting. Overridable for staging.
 */
function resolveHeroUrl(): string | undefined {
  const explicit = (Deno.env.get("GOOGLE_WALLET_HERO_URL") ?? "").trim();
  if (explicit.startsWith("https://")) return explicit;
  const appUrl = (Deno.env.get("WALLET_PUBLIC_APP_URL") ?? Deno.env.get("VITE_APP_URL") ?? "").trim().replace(/\/$/, "");
  if (appUrl.startsWith("https://")) return `${appUrl}/${WALLET_HERO_ASSET_PATH}`;
  return undefined;
}

/**
 * Shared Google Wallet credential bootstrap for edge functions.
 * Secrets stay in Deno.env — never returned to clients.
 */

import { createRs256SignerFromPkcs8Pem } from "./googleWalletPass.ts";
import { googleWalletEnvLooksConfigured } from "./googleWalletConfiguredCheck.ts";
import { resolveWalletAllowedOrigins } from "./walletAllowedOrigins.ts";
import { WALLET_HERO_ASSET_PATH, type GoogleWalletSigner } from "./walletPassTypes.ts";

export type GoogleWalletEnv =
  | {
      ok: true;
      issuerId: string;
      signer: GoogleWalletSigner;
      origins: string[];
      logoUrl: string | undefined;
      /** Premium card banner for the LoyaltyObject. Static brand artwork only. */
      heroImageUrl: string | undefined;
    }
  | { ok: false; error: "wallet_not_configured" | "wallet_misconfigured" };

export { googleWalletEnvLooksConfigured };

function resolveLogoUrl(): string | undefined {
  const explicit = (Deno.env.get("GOOGLE_WALLET_LOGO_URL") ?? "").trim();
  if (explicit.startsWith("https://")) return explicit;
  const appUrl = (Deno.env.get("WALLET_PUBLIC_APP_URL") ?? Deno.env.get("VITE_APP_URL") ?? "").trim().replace(/\/$/, "");
  if (appUrl.startsWith("https://")) return `${appUrl}/waka-logo.png`;
  return undefined;
}

/**
 * Cheap presence check for public card responses.
 * Does NOT JSON-parse the service account or import/parse the PEM private key.
 * Actual issuance must still call `loadGoogleWalletEnv()` which fully validates.
 */
export function isGoogleWalletConfigured(): boolean {
  return googleWalletEnvLooksConfigured(
    Deno.env.get("GOOGLE_WALLET_ISSUER_ID") ?? "",
    Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON") ?? "",
  );
}

/** Full credential load for Wallet issuance only (parses SA JSON + builds RS256 signer). */
export function loadGoogleWalletEnv(): GoogleWalletEnv {
  const issuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID") ?? "";
  const serviceAccountJson = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON") ?? "";
  if (!issuerId.trim() || !serviceAccountJson.trim()) {
    return { ok: false, error: "wallet_not_configured" };
  }
  let serviceAccount: { client_email?: string; private_key?: string };
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    return { ok: false, error: "wallet_misconfigured" };
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    return { ok: false, error: "wallet_misconfigured" };
  }
  // Save JWTs require origins. The deployed secret wins; unset falls back to the live DKASU
  // surfaces with the legacy WAKA origins retained (see walletAllowedOrigins.ts).
  const resolvedOrigins = resolveWalletAllowedOrigins(Deno.env.get("WALLET_ALLOWED_ORIGINS"));

  return {
    ok: true,
    issuerId: issuerId.trim(),
    signer: createRs256SignerFromPkcs8Pem(serviceAccount.client_email, serviceAccount.private_key),
    origins: resolvedOrigins,
    logoUrl: resolveLogoUrl(),
    heroImageUrl: resolveHeroUrl(),
  };
}
