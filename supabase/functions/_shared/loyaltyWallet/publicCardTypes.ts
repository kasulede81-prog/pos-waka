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

export type PublicCardSafeDesign = {
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  program_name: string;
  welcome_message: string | null;
  style: "classic" | "modern" | "minimal" | "premium";
  reward_layout: "list" | "cards";
};

export type PublicCardSafePayload = {
  ok: true;
  customer_name: string;
  shop_name: string;
  program_name: string;
  balance_points: number;
  account_active: boolean;
  program_enabled: boolean;
  /** C1: derived membership status (never exposes private config). */
  membership_active: boolean;
  /** Inclusive Kampala calendar end date YYYY-MM-DD, or null if never expires. */
  membership_expires_on: string | null;
  qr_payload: string;
  rewards: Array<{ name: string; points_required: number; description: string | null }>;
  /** Decision 029: rewards assigned specifically to this customer. */
  your_rewards?: Array<{ name: string; points_required: number; description: string | null }>;
  wallet_configured: boolean;
  design?: PublicCardSafeDesign;
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
    "assignment_id",
    "reward_id",
  ];
  for (const key of Object.keys(body)) {
    if (forbidden.includes(key.toLowerCase())) {
      throw new Error("unsafe_public_card_field");
    }
  }
}
