import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { lookupPublicLoyaltyCard } from "../_shared/loyaltyWallet/publicCardLookup.ts";
import { assertSafePublicCardJson, isValidPublicCardTokenFormat } from "../_shared/loyaltyWallet/publicCardTypes.ts";
import { enforceCardReadRateLimit } from "../_shared/loyaltyWallet/publicCardDurableRateLimit.ts";

/**
 * Public loyalty card read (Phase 3).
 *
 * GET ?token=<public_card_token>
 * No merchant auth. Authority: public_card_token → account → shop.
 * Durable Postgres rate limit before lookup. Never logs tokens.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "X-Robots-Tag": "noindex, nofollow",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "unavailable" }, 500);
  }

  const url = new URL(req.url);
  // Ignore any client-supplied shop_id / account_id — token is the only authority.
  const token = (url.searchParams.get("token") ?? "").trim();
  const tokenForHash = isValidPublicCardTokenFormat(token) ? token : null;

  // Durable limiter is authoritative. Fail closed on RPC/DB errors.
  const rate = await enforceCardReadRateLimit(req, supabaseUrl, serviceKey, tokenForHash);
  if (!rate.ok) {
    if (rate.error === "rate_limited") {
      return json(
        { ok: false, error: "rate_limited", retry_after_seconds: rate.retryAfterSeconds },
        429,
      );
    }
    return json({ ok: false, error: "unavailable" }, 503);
  }

  const result = await lookupPublicLoyaltyCard(supabaseUrl, serviceKey, token);
  if (!result.ok) {
    const status =
      result.error === "token_required" || result.error === "token_invalid"
        ? 400
        : result.error === "not_found"
          ? 404
          : 503;
    return json({ ok: false, error: result.error }, status);
  }

  const body: Record<string, unknown> = { ...result };
  try {
    assertSafePublicCardJson(body);
  } catch {
    return json({ ok: false, error: "unavailable" }, 500);
  }
  return json(body, 200);
});
