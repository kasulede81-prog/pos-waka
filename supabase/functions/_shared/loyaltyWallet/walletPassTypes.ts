/**
 * Loyalty wallet pass — shared types (Phase 06).
 *
 * Edge runtime copy: supabase/functions/_shared/loyaltyWallet/walletPassTypes.ts
 * (pure TypeScript + WebCrypto only — runs in Deno and in Node/vitest).
 *
 * These types model what a loyalty pass needs on BOTH platforms. Signing is
 * always injected: Wallet signing material (Google service account key,
 * Apple pass certificate + WWDR) lives ONLY in server-side secrets and is
 * never bundled into the frontend.
 */

/** Everything a pass renderer needs; produced server-side from the account. */
export type LoyaltyPassInput = {
  shopId: string;
  shopName: string;
  accountId: string;
  /** Printed on the pass. Keep minimal — no phone numbers. */
  customerName: string;
  /** Opaque membership token; becomes the pass barcode payload. */
  qrToken: string;
  /** Full barcode payload (e.g. "WAKA-LOYALTY:<qrToken>"). */
  qrPayload: string;
  balancePoints: number;
  /** Human earning rule, e.g. "1 pt per UGX 1,000 spent". */
  programLabel: string;
  backgroundColor?: string;
  foregroundColor?: string;
  labelColor?: string;
  /** Hosted https asset required by both platforms. */
  logoUrl?: string;
};

/**
 * Signs the manifest for an Apple wallet pass bundle. Implementations must
 * produce a detached PKCS#7 signature (S/MIME, signed-data) over the exact
 * manifest JSON bytes using the Apple-issued pass certificate plus the Apple
 * WWDR certificate. Requires Apple Developer Program credentials — see
 * docs/waka-loyalty-prompts/docs/loyalty/WALLET-INTEGRATION.md.
 */
export type ApplePassSigner = {
  signManifest(manifestJsonBytes: Uint8Array): Promise<Uint8Array>;
};

/**
 * Signs the JWT used for Google Wallet "Save to Wallet" URLs (RS256 with the
 * Google Cloud service account private key). Implementations return the compact
 * JWS string.
 */
export type GoogleWalletSigner = {
  serviceAccountEmail: string;
  signJwt(claims: Record<string, unknown>): Promise<string>;
};

export type IssuedWalletPass =
  | { provider: "google_wallet"; saveUrl: string }
  | { provider: "apple_wallet"; pkpass: Uint8Array; filename: string };

export type WalletIssueError =
  | "wallet_not_configured"
  | "signing_failed"
  | "invalid_input";

export type WalletIssueResult =
  | { ok: true; pass: IssuedWalletPass }
  | { ok: false; error: WalletIssueError };
