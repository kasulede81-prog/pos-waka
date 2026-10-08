import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getProviderAdapter } from "../_shared/payment/adapter.ts";
import { lookupPaymentByReference, runCallbackSettlement } from "../_shared/payment/callbackSettle.ts";
// Registers the MTN MoMo adapter into the shared registry (module side effect).
import "../_shared/payment/providers/mtnMomo.ts";
import { cancelPayment, confirmPayment, failPayment, flagPaymentReconciliation } from "../_shared/payment/ledger.ts";

/**
 * payment-callback-mtnmomo — provider-agnostic settlement shell (M3-E).
 *
 * THIN SHELL ONLY: no MTN API code, no signature algorithm, no credentials —
 * every provider-specific detail is PROVIDER DOCUMENTATION REQUIRED and lands
 * with M3-F (the adapter registry is empty, so this endpoint currently fails
 * closed with provider_not_configured / 503).
 *
 * verify_jwt = false (supabase/config.toml): providers have no Supabase JWT,
 * so authority comes exclusively from signature verification over the RAW
 * body inside runCallbackSettlement — performed BEFORE any parsing, any
 * ledger lookup, and any settlement.
 *
 * Rate limiting is intentionally NOT wired here: the repository's durable
 * edge_rate_limit buckets are DB-constrained to scope ('card_read',
 * 'wallet_issue'); adding a payment scope would require editing loyalty code
 * plus a second migration (documented M3-E follow-up, not redesigned here).
 */

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, reason: "server_misconfigured" }, 500);
  }

  // RAW body first — never parsed before signature verification.
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const serviceClient = createClient(supabaseUrl, serviceKey);

  const result = await runCallbackSettlement({
    provider: "mtn_momo",
    method: req.method,
    rawBody,
    headers,
    adapter: getProviderAdapter("mtn_momo"),
    lookup: (provider, reference) => lookupPaymentByReference(serviceClient, provider, reference),
    confirm: (paymentId) => confirmPayment(serviceClient, paymentId),
    fail: (paymentId, reason) => failPayment(serviceClient, paymentId, reason),
    cancel: (paymentId, reason) => cancelPayment(serviceClient, paymentId, reason),
    // M3-G: stale_success → explicit auditable reconciliation marker.
    flagReconciliation: (paymentId, reason) =>
      flagPaymentReconciliation(serviceClient, paymentId, reason),
  });

  return json(result.body, result.httpStatus);
});
