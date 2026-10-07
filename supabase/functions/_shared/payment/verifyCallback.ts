/**
 * M3-C — callback verification contract (core only).
 *
 * Follows the repository's existing verified-webhook precedent
 * (supabase/functions/auth-send-email/index.ts):
 *
 *   const raw = await req.text();        // RAW body, before any JSON parsing
 *   verifier(raw, headers)               // signature check FIRST
 *   → reject (401) with zero ledger writes on failure
 *
 * The actual signature scheme (header names, canonical string, algorithm) is
 * PROVIDER DOCUMENTATION REQUIRED and therefore lives inside each future
 * provider adapter's verifyCallback(). This module only guarantees the
 * orchestration contract: raw body in, verification before any ledger access,
 * normalized result out. Generic HMAC is an abstraction the adapter may
 * implement — nothing crypto-specific is invented here.
 *
 * No MTN / Airtel callback endpoints exist yet (M3-E/M3-F/M3-G).
 */

import type { ProviderAdapter } from "./adapter.ts";
import type { CallbackRequest, VerifiedCallback } from "./types.ts";

/**
 * Run a provider's callback verification over the untouched raw body.
 *
 * - never throws: a verifier that throws is treated as a failed verification
 *   (fail closed, no ledger writes possible because callers only settle on ok)
 * - the rawBody is passed through verbatim (HMAC must cover exact bytes)
 */
export async function verifyCallbackWith(
  adapter: ProviderAdapter,
  req: CallbackRequest,
): Promise<VerifiedCallback> {
  if (typeof req.rawBody !== "string" || req.rawBody.length === 0) {
    return { ok: false, error: "empty_callback_body" };
  }
  try {
    const result = await adapter.verifyCallback({
      rawBody: req.rawBody,
      headers: req.headers ?? {},
    });
    if (!result || typeof result.ok !== "boolean") {
      return { ok: false, error: "verification_failed" };
    }
    if (result.ok !== true) {
      return { ok: false, error: result.error || "verification_failed" };
    }
    if (typeof result.reference !== "string" || result.reference.length === 0) {
      // A verified callback that carries no payment reference cannot be mapped
      // to the ledger — reject rather than guess.
      return { ok: false, error: "callback_missing_reference" };
    }
    if (typeof result.rawStatus !== "string" || result.rawStatus.length === 0) {
      return { ok: false, error: "callback_missing_status" };
    }
    return result;
  } catch {
    return { ok: false, error: "verification_failed" };
  }
}
