/**
 * Google Wallet Objects REST helpers (Phase 5).
 *
 * Upserts LoyaltyClass / LoyaltyObject and patches points balance via the
 * walletobjects API. Signing material is injected — never read from env here.
 *
 * Docs: https://developers.google.com/wallet/retail/loyalty-cards/rest
 */

import type { GoogleWalletSigner } from "./walletPassTypes.ts";
import { googleClassId, googleObjectId, type GoogleIds } from "./googleWalletPass.ts";

export const GOOGLE_WALLET_OBJECTS_SCOPE =
  "https://www.googleapis.com/auth/wallet_object.issuer";

export const GOOGLE_WALLET_API_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";

export type GoogleAccessToken = {
  accessToken: string;
  expiresAtSeconds: number;
};

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** OAuth2 JWT assertion claims for the Wallet Objects API. */
export function buildGoogleWalletOAuthClaims(
  serviceAccountEmail: string,
  nowSeconds: number,
  scope = GOOGLE_WALLET_OBJECTS_SCOPE,
): Record<string, unknown> {
  return {
    iss: serviceAccountEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
}

export async function fetchGoogleWalletAccessToken(
  signer: GoogleWalletSigner,
  nowSeconds: number,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<GoogleAccessToken> {
  const assertion = await signer.signJwt(buildGoogleWalletOAuthClaims(signer.serviceAccountEmail, nowSeconds));
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`google_oauth_failed:${res.status}`);
  }
  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
  } catch {
    throw new Error("google_oauth_invalid_json");
  }
  if (!parsed.access_token) throw new Error("google_oauth_missing_token");
  return {
    accessToken: parsed.access_token,
    expiresAtSeconds: nowSeconds + Math.max(60, Number(parsed.expires_in ?? 3600) - 60),
  };
}

export type WalletApiResult = {
  ok: boolean;
  status: number;
  body: string;
  /** Safe Google error.status / errors[].reason — never secrets. */
  googleStatus?: string;
  googleReason?: string;
  googleMessage?: string;
};

function parseGoogleApiError(body: string): Pick<WalletApiResult, "googleStatus" | "googleReason" | "googleMessage"> {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; message?: string; errors?: Array<{ reason?: string }> };
    };
    const err = parsed.error;
    if (!err) return {};
    return {
      googleStatus: err.status,
      googleReason: err.errors?.map((e) => e.reason).filter(Boolean).join(",") || undefined,
      googleMessage: typeof err.message === "string" ? err.message.slice(0, 300) : undefined,
    };
  } catch {
    return {};
  }
}

async function walletApi(
  accessToken: string,
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  fetchImpl: FetchLike,
): Promise<WalletApiResult> {
  const res = await fetchImpl(`${GOOGLE_WALLET_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const meta = res.ok ? {} : parseGoogleApiError(text);
  return { ok: res.ok, status: res.status, body: text, ...meta };
}

/**
 * Insert class; if it already exists (409), PATCH/UPDATE is skipped — class
 * metadata is stable per shop. Returns ok even on 409.
 */
export async function upsertGoogleLoyaltyClass(
  accessToken: string,
  loyaltyClass: Record<string, unknown>,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<{ ok: boolean; status: number; created: boolean; googleStatus?: string; googleReason?: string; googleMessage?: string }> {
  const insert = await walletApi(accessToken, "POST", "/loyaltyClass", loyaltyClass, fetchImpl);
  if (insert.ok) return { ok: true, status: insert.status, created: true };
  if (insert.status === 409) return { ok: true, status: 409, created: false };
  // Retry as PUT update for recoverable conflicts / revisions.
  const id = String(loyaltyClass.id ?? "");
  if (!id) {
    return {
      ok: false,
      status: insert.status,
      created: false,
      googleStatus: insert.googleStatus,
      googleReason: insert.googleReason,
      googleMessage: insert.googleMessage,
    };
  }
  const update = await walletApi(
    accessToken,
    "PUT",
    `/loyaltyClass/${encodeURIComponent(id)}`,
    loyaltyClass,
    fetchImpl,
  );
  return {
    ok: update.ok,
    status: update.status,
    created: false,
    googleStatus: update.googleStatus ?? insert.googleStatus,
    googleReason: update.googleReason ?? insert.googleReason,
    googleMessage: update.googleMessage ?? insert.googleMessage,
  };
}

/**
 * Insert object; on 409, PUT full resource so balance/barcode stay current.
 * Deterministic object ids (issuer.acct_<accountUuid>) make re-issue safe.
 */
export async function upsertGoogleLoyaltyObject(
  accessToken: string,
  loyaltyObject: Record<string, unknown>,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<{ ok: boolean; status: number; created: boolean; googleStatus?: string; googleReason?: string; googleMessage?: string }> {
  const insert = await walletApi(accessToken, "POST", "/loyaltyObject", loyaltyObject, fetchImpl);
  if (insert.ok) return { ok: true, status: insert.status, created: true };
  if (insert.status !== 409) {
    return {
      ok: false,
      status: insert.status,
      created: false,
      googleStatus: insert.googleStatus,
      googleReason: insert.googleReason,
      googleMessage: insert.googleMessage,
    };
  }
  const id = String(loyaltyObject.id ?? "");
  if (!id) return { ok: false, status: 409, created: false };
  const update = await walletApi(
    accessToken,
    "PUT",
    `/loyaltyObject/${encodeURIComponent(id)}`,
    loyaltyObject,
    fetchImpl,
  );
  return {
    ok: update.ok,
    status: update.status,
    created: false,
    googleStatus: update.googleStatus,
    googleReason: update.googleReason,
    googleMessage: update.googleMessage,
  };
}

/** Patch only the points balance — used by the ledger → wallet sync outbox. */
export async function patchGoogleLoyaltyObjectBalance(
  accessToken: string,
  ids: GoogleIds,
  balancePoints: number,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<{ ok: boolean; status: number }> {
  const resourceId = googleObjectId(ids);
  const patch = await walletApi(
    accessToken,
    "PATCH",
    `/loyaltyObject/${encodeURIComponent(resourceId)}`,
    {
      loyaltyPoints: {
        label: "Points",
        balance: { int: Math.trunc(Math.max(0, balancePoints)) },
      },
    },
    fetchImpl,
  );
  return { ok: patch.ok, status: patch.status };
}

export function deterministicGoogleWalletIds(
  issuerId: string,
  shopId: string,
  accountId: string,
): GoogleIds {
  return {
    issuerId,
    classId: `waka_loyalty_${shopId}`,
    objectId: `acct_${accountId}`,
  };
}

export function googleWalletResourceIds(ids: GoogleIds): { classResourceId: string; objectResourceId: string } {
  return { classResourceId: googleClassId(ids), objectResourceId: googleObjectId(ids) };
}

/** Exported for tests — encoding helper used by OAuth JWT packing elsewhere. */
export function encodeJwtSegmentForTests(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}
