/**
 * Shared helpers for public loyalty card Edge Functions.
 * Token → account → shop authority chain. Never returns phone/email.
 */

export const PUBLIC_CARD_TOKEN_RE = /^[a-f0-9]{64}$/i;
export const LOYALTY_QR_PREFIX = "WAKA-LOYALTY:";

export function isValidPublicCardTokenFormat(token: string): boolean {
  return PUBLIC_CARD_TOKEN_RE.test(token.trim());
}

export type PublicCardAccountRow = {
  id: string;
  shop_id: string;
  customer_id: string;
  status: string;
  balance_points: number;
  qr_token: string;
};

export type PublicCardSafePayload = {
  ok: true;
  customer_name: string;
  shop_name: string;
  program_name: string;
  balance_points: number;
  account_active: boolean;
  program_enabled: boolean;
  qr_payload: string;
  rewards: Array<{ name: string; points_required: number; description: string | null }>;
  wallet_configured: boolean;
};

export type PublicCardLookupError = {
  ok: false;
  error: "token_required" | "token_invalid" | "not_found" | "unavailable";
};

export function encodeLoyaltyQrPayload(qrToken: string): string {
  return `${LOYALTY_QR_PREFIX}${qrToken}`;
}

/** Strip any accidental sensitive keys from a response object (defense in depth). */
export function assertSafePublicCardJson(body: Record<string, unknown>): void {
  const forbidden = [
    "phone",
    "phone_e164",
    "email",
    "customer_id",
    "account_id",
    "shop_id",
    "user_id",
    "auth",
    "private_key",
    "service_account",
    "qr_token",
    "public_card_token",
    "save_url",
  ];
  for (const key of Object.keys(body)) {
    if (forbidden.includes(key.toLowerCase())) {
      throw new Error("unsafe_public_card_field");
    }
  }
}
