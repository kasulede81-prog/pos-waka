/**
 * Shared Google Wallet credential bootstrap for edge functions.
 * Secrets stay in Deno.env — never returned to clients.
 */

import { createRs256SignerFromPkcs8Pem } from "./googleWalletPass.ts";
import { googleWalletEnvLooksConfigured } from "./googleWalletConfiguredCheck.ts";
import type { GoogleWalletSigner } from "./walletPassTypes.ts";

export type GoogleWalletEnv =
  | {
      ok: true;
      issuerId: string;
      signer: GoogleWalletSigner;
      origins: string[];
      logoUrl: string | undefined;
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
  const origins = (Deno.env.get("WALLET_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // Save JWTs require origins; fall back to the live WAKA surfaces when unset.
  const resolvedOrigins =
    origins.length > 0
      ? origins
      : ["https://pos.waka.ug", "https://loyalty.waka.ug"];

  return {
    ok: true,
    issuerId: issuerId.trim(),
    signer: createRs256SignerFromPkcs8Pem(serviceAccount.client_email, serviceAccount.private_key),
    origins: resolvedOrigins,
    logoUrl: resolveLogoUrl(),
  };
}
