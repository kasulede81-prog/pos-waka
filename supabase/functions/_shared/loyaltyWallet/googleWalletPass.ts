/**
 * Google Wallet loyalty pass builder (Phase 06).
 *
 * Edge runtime copy: supabase/functions/_shared/loyaltyWallet/googleWalletPass.ts
 * Pure TypeScript + WebCrypto. JWT signing is injected via
 * `GoogleWalletSigner` (Google Cloud service account RSA key → RS256).
 *
 * Produces the "Save to Google Wallet" URL flow: a signed JWT carrying the
 * LoyaltyClass + LoyaltyObject, exchanged at
 * https://pay.google.com/gp/v/save/<jwt>.
 */

import type { GoogleWalletSigner, LoyaltyPassInput } from "./walletPassTypes.ts";

export type GoogleIds = {
  issuerId: string;
  classId: string;
  objectId: string;
};

export function googleClassId(ids: Pick<GoogleIds, "issuerId" | "classId">): string {
  return `${ids.issuerId}.${ids.classId}`;
}

export function googleObjectId(ids: GoogleIds): string {
  return `${ids.issuerId}.${ids.objectId}`;
}

/** LoyaltyClass — one per loyalty program (shop). */
export function buildGoogleLoyaltyClass(
  input: LoyaltyPassInput,
  ids: Pick<GoogleIds, "issuerId" | "classId">,
): Record<string, unknown> {
  return {
    id: googleClassId(ids),
    issuerName: input.shopName,
    programName: `${input.shopName} Loyalty`,
    programLogo: input.logoUrl ? { sourceUri: { uri: input.logoUrl } } : undefined,
    hexBackgroundColor: normalizeHexColor(input.backgroundColor ?? "#facc15"),
    reviewStatus: "UNDER_REVIEW",
  };
}

/** LoyaltyObject — one per member; carries the balance + barcode. */
export function buildGoogleLoyaltyObject(
  input: LoyaltyPassInput,
  ids: GoogleIds,
): Record<string, unknown> {
  return {
    id: googleObjectId(ids),
    classId: googleClassId(ids),
    state: "active",
    loyaltyPoints: {
      label: "Points",
      balance: {
        int: Math.trunc(input.balancePoints),
      },
    },
    accountName: input.customerName,
    accountId: input.accountId,
    barcode: {
      type: "QR_CODE",
      value: input.qrPayload,
      alternateText: input.qrToken.slice(0, 16),
    },
    textModulesData: [
      {
        header: "Earns",
        body: input.programLabel,
        id: "earn_rule",
      },
    ],
  };
}

function normalizeHexColor(color: string): string {
  const c = color.trim();
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : "#facc15";
}

export type GoogleSaveJwtClaims = {
  iss: string;
  aud: "google";
  typ: "savetowallet";
  iat: number;
  exp: number;
  origins: string[];
  payload: {
    loyaltyClasses: Record<string, unknown>[];
    loyaltyObjects: Record<string, unknown>[];
  };
};

export function buildGoogleSaveJwtClaims(
  signer: Pick<GoogleWalletSigner, "serviceAccountEmail">,
  loyaltyClass: Record<string, unknown>,
  loyaltyObject: Record<string, unknown>,
  origins: string[],
  nowSeconds: number,
): GoogleSaveJwtClaims {
  return {
    iss: signer.serviceAccountEmail,
    aud: "google",
    typ: "savetowallet",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
    origins,
    payload: {
      loyaltyClasses: [loyaltyClass],
      loyaltyObjects: [loyaltyObject],
    },
  };
}

export const GOOGLE_WALLET_SAVE_URL_BASE = "https://pay.google.com/gp/v/save/";

export async function buildGoogleWalletSaveUrl(
  signer: GoogleWalletSigner,
  claims: GoogleSaveJwtClaims,
): Promise<string> {
  const jwt = await signer.signJwt(claims as unknown as Record<string, unknown>);
  return `${GOOGLE_WALLET_SAVE_URL_BASE}${jwt}`;
}

// ---------- Default WebCrypto RS256 signer (Google Cloud SA keys are RSA) ----------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Creates an RS256 JWT signer from a PKCS#8 PEM private key (the format in a
 * Google Cloud service account JSON `private_key`). Google Wallet OAuth
 * assertions and Save JWTs both require RS256 — not ES256.
 * Usable in Deno and Node 19+.
 */
export function createRs256SignerFromPkcs8Pem(
  serviceAccountEmail: string,
  pkcs8Pem: string,
): GoogleWalletSigner {
  return {
    serviceAccountEmail,
    async signJwt(claims: Record<string, unknown>): Promise<string> {
      const header = { alg: "RS256", typ: "JWT" };
      const headerSegment = base64UrlEncode(
        new TextEncoder().encode(JSON.stringify(header)),
      );
      const payloadSegment = base64UrlEncode(
        new TextEncoder().encode(JSON.stringify(claims)),
      );
      const key = await crypto.subtle.importKey(
        "pkcs8",
        pemToDer(pkcs8Pem) as BufferSource,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        key,
        new TextEncoder().encode(`${headerSegment}.${payloadSegment}`) as BufferSource,
      );
      return `${headerSegment}.${payloadSegment}.${base64UrlEncode(new Uint8Array(signature))}`;
    },
  };
}
