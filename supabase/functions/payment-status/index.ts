import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getProviderAdapter } from "../_shared/payment/adapter.ts";
import {
  cancelPayment,
  confirmPayment,
  failPayment,
  fetchPaymentRow,
  runStatusFlow,
} from "../_shared/payment/ledger.ts";
import type { FlowResult } from "../_shared/payment/types.ts";

/**
 * payment-status (M3-C) — provider status recovery for a pending payment.
 *
 * verify_jwt = true. Request body: ONLY { payment_id }. The caller is
 * authorized through M3-B's subscription_payment_get (same gate as initiate);
 * provider + reference + amount come from the ledger; settlement happens
 * exclusively through the M1 RPCs (confirm / fail / cancel) — this function
 * never updates subscriptions or payment status itself.
 *
 * Terminal payments return their current ledger state without touching the
 * provider. Unknown provider status leaves the payment pending.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusFor(result: FlowResult): number {
  if (result.ok) return 200;
  switch (result.error) {
    case "payment_not_found":
      return 404;
    case "invalid_payment_id":
      return 400;
    case "not_initiated":
    case "subscription_conflict":
    case "payment_not_confirmable":
    case "payment_not_failed":
    case "payment_not_cancelable":
      return 409;
    case "provider_not_configured":
      return 503;
    case "provider_query_timeout":
      return 504;
    case "provider_query_failed":
      return 502;
    default:
      return result.retryable ? 502 : 500;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  // ONLY payment_id is read from the client.
  const paymentId = typeof body.payment_id === "string" ? body.payment_id.trim() : "";
  if (!UUID_RE.test(paymentId)) return json({ ok: false, error: "invalid_payment_id" }, 400);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const authorize = async (): Promise<{ ok: boolean; error?: string }> => {
    const { data, error } = await userClient.rpc("subscription_payment_get", {
      p_payment_id: paymentId,
    });
    if (error) return { ok: false, error: "payment_not_found" };
    const body_ = (data ?? {}) as Record<string, unknown>;
    if (body_.ok === true) return { ok: true };
    return {
      ok: false,
      error: typeof body_.error === "string" ? body_.error : "payment_not_found",
    };
  };

  const serviceClient = createClient(supabaseUrl, serviceKey);

  const result = await runStatusFlow({
    authorize,
    fetchRow: () => fetchPaymentRow(serviceClient, paymentId),
    confirm: () => confirmPayment(serviceClient, paymentId),
    fail: (reason) => failPayment(serviceClient, paymentId, reason),
    cancel: (reason) => cancelPayment(serviceClient, paymentId, reason),
    resolveAdapter: (provider) => getProviderAdapter(provider),
  });

  return json({ ...result }, statusFor(result));
});
