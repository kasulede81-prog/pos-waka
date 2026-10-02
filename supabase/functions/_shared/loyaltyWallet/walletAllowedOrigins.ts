/**
 * Google Wallet Save-JWT allowed origins (no Deno, no RSA) — shared by the Edge env loader
 * (`googleWalletEnv.ts`) and unit tests, mirroring `googleWalletConfiguredCheck.ts`.
 *
 * Google validates the page origin that requests a save against the JWT `origins` claim, so this
 * list is a security boundary in both directions: an origin that is MISSING refuses a legitimate
 * save, and an origin that is present but foreign lets another site mint saves. Exact https origins
 * only — never a wildcard, never a bare scheme or host.
 */

/**
 * The live surfaces, used ONLY when `WALLET_ALLOWED_ORIGINS` is unset.
 *
 * DKASU first — the production surfaces since the 2026-10-02 auth migration. The WAKA origins are
 * retained for the migration window: they 308 to DKASU, and a customer with an already-open old tab
 * must still be able to save a pass.
 */
export const DEFAULT_WALLET_ALLOWED_ORIGINS: readonly string[] = [
  "https://pos.dkasu.com",
  "https://loyalty.dkasu.com",
  "https://pos.waka.ug",
  "https://loyalty.waka.ug",
];

/**
 * Parse the comma-separated `WALLET_ALLOWED_ORIGINS` secret. An explicit value is honoured verbatim
 * (trimmed, blank entries dropped) — the deployed secret is authoritative and this function must not
 * silently add or remove origins; the default applies only when the secret is missing or empty.
 */
export function resolveWalletAllowedOrigins(raw: string | null | undefined): string[] {
  const origins = String(raw ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : [...DEFAULT_WALLET_ALLOWED_ORIGINS];
}
