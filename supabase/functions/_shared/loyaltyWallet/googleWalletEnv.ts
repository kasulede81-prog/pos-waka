/**
 * Shared Google Wallet credential bootstrap for edge functions.
 * Secrets stay in Deno.env — never returned to clients.
 */

import { createEs256SignerFromPkcs8Pem } from "./googleWalletPass.ts";
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

function resolveLogoUrl(): string | undefined {
  const explicit = (Deno.env.get("GOOGLE_WALLET_LOGO_URL") ?? "").trim();
  if (explicit.startsWith("https://")) return explicit;
  const appUrl = (Deno.env.get("WALLET_PUBLIC_APP_URL") ?? Deno.env.get("VITE_APP_URL") ?? "").trim().replace(/\/$/, "");
  if (appUrl.startsWith("https://")) return `${appUrl}/waka-logo.png`;
  return undefined;
}

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

  return {
    ok: true,
    issuerId: issuerId.trim(),
    signer: createEs256SignerFromPkcs8Pem(serviceAccount.client_email, serviceAccount.private_key),
    origins,
    logoUrl: resolveLogoUrl(),
  };
}

export function isGoogleWalletConfigured(): boolean {
  return loadGoogleWalletEnv().ok;
}
