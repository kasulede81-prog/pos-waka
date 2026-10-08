import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getProviderAdapter } from "../_shared/payment/adapter.ts";
// Registers the MTN MoMo adapter into the shared registry (module side effect).
import "../_shared/payment/providers/mtnMomo.ts";
import {
  fetchPaymentRow,
  attachProviderMeta,
  claimProviderInitiation,
  failPayment,
  flagPaymentReconciliation,
  runInitiateFlow,
} from "../_shared/payment/ledger.ts";
import type { FlowResult } from "../_shared/payment/types.ts";

/**
 * payment-initiate (M3-C) — provider-agnostic server-side initiation.
 *
 * verify_jwt = true (config.toml): the gateway already rejected anonymous
 * calls, and the caller's own JWT authorizes the payment via M3-B's
 * subscription_payment_get (owner/admin/billing | internal — foreign payment
 * ids are indistinguishable from missing ones).
 *
 * Request body carries ONLY { payment_id, phone }. Every monetary and
 * ownership value (amount, currency, provider, reference, organization, shop,
 * subscription, plan) is read from the payment ledger — never from the client.
 *
 * No provider adapter is registered yet (registry is empty until M3-F/M3-G),
 * so this function currently fails closed with provider_not_configured.
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
    case "invalid_phone":
      return 400;
    case "payment_not_pending":
    case "reference_missing":
    case "initiate_in_progress":
      return 409;
    case "provider_not_configured":
      return 503;
    case "initiate_timeout":
      return 504;
    case "provider_rejected":
      return 502;
    case "attach_failed":
      return 500;
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

  // ONLY these two fields are read from the client; everything else the body
  // might carry (amount, currency, plan, shop, organization, provider…) is
  // ignored by construction and cannot influence the ledger.
  const paymentId = typeof body.payment_id === "string" ? body.payment_id.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!UUID_RE.test(paymentId)) return json({ ok: false, error: "invalid_payment_id" }, 400);

  // Caller identity: PostgREST executes this RPC with the caller's JWT, so the
  // M3-B gate (can_initiate on the payment's organization) is enforced exactly.
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

  const result = await runInitiateFlow({
    authorize,
    fetchRow: () => fetchPaymentRow(serviceClient, paymentId),
    attach: (input) =>
      attachProviderMeta(serviceClient, {
        payment_id: paymentId,
        provider_reference: input.provider_reference,
        phone: input.phone,
      }),
    fail: (reason) => failPayment(serviceClient, paymentId, reason),
    resolveAdapter: (provider) => getProviderAdapter(provider),
    // M3-G: claim before the provider call — concurrent initiates cannot both
    // start a provider transaction (the loser observes initiate_in_progress).
    claim: () => claimProviderInitiation(serviceClient, paymentId),
    // Observability: stage-specific reconciliation reason on the payment row
    // (history/audit only — constant strings, no secrets, no state change).
    flagReconciliation: (id, reason) => flagPaymentReconciliation(serviceClient, id, reason),
    phone,
  });

  return json({ ...result }, statusFor(result));
});
