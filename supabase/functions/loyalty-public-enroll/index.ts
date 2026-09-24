import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isValidPublicCardTokenFormat } from "../_shared/loyaltyWallet/publicCardTypes.ts";
import {
  enforceEnrollJoinRateLimit,
  enforceEnrollSubmitRateLimit,
} from "../_shared/loyaltyWallet/publicCardDurableRateLimit.ts";

/**
 * Public loyalty self-enrollment (Decision 028).
 *
 * GET  ?token=<enrollment_token>  → branding preview (no PII)
 * POST { token, name, phone, email?, consent } → enroll
 *
 * Authority: enrollment token → shop. Client shop_id ignored.
 * Never returns qr_token / account_id / shop_id.
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

function normalizeUgPhone(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (digits.startsWith("256") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+256${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("7")) return `+256${digits}`;
  const compact = v.replace(/\s/g, "");
  if (compact.startsWith("+256") && /^\+256[0-9]{9}$/.test(compact)) return compact;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "unavailable" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") ?? "").trim();
    const tokenForHash = isValidPublicCardTokenFormat(token) ? token : null;

    const rate = await enforceEnrollJoinRateLimit(req, supabaseUrl, serviceKey, tokenForHash);
    if (!rate.ok) {
      if (rate.error === "rate_limited") {
        return json(
          { ok: false, error: "rate_limited", retry_after_seconds: rate.retryAfterSeconds },
          429,
        );
      }
      return json({ ok: false, error: "unavailable" }, 503);
    }

    const { data, error } = await admin.rpc("loyalty_preview_enrollment_link", {
      p_token: token,
    });
    if (error) return json({ ok: false, error: "unavailable" }, 503);
    const body = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown>;
    if (!body || body.ok !== true) {
      const err = String(body?.error ?? "not_found");
      const status =
        err === "token_invalid" ? 400 : err === "unavailable" ? 410 : 404;
      return json({ ok: false, error: err }, status);
    }
    // Strip any accidental internal ids
    return json({
      ok: true,
      shop_name: String(body.shop_name ?? ""),
      welcome_message: String(body.welcome_message ?? ""),
      logo_url: String(body.logo_url ?? ""),
      primary_color: String(body.primary_color ?? ""),
      program_enabled: Boolean(body.program_enabled),
    });
  }

  if (req.method === "POST") {
    let body: {
      token?: string;
      name?: string;
      phone?: string;
      email?: string;
      consent?: boolean;
      shop_id?: string;
      account_id?: string;
      points?: number;
      balance?: number;
    };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid_body" }, 400);
    }

    // Explicitly ignore client shop/account/points/balance.
    void body.shop_id;
    void body.account_id;
    void body.points;
    void body.balance;

    const token = String(body.token ?? "").trim();
    if (!isValidPublicCardTokenFormat(token)) {
      return json({ ok: false, error: "token_invalid" }, 400);
    }

    const rate = await enforceEnrollSubmitRateLimit(req, supabaseUrl, serviceKey, token);
    if (!rate.ok) {
      if (rate.error === "rate_limited") {
        return json(
          { ok: false, error: "rate_limited", retry_after_seconds: rate.retryAfterSeconds },
          429,
        );
      }
      return json({ ok: false, error: "unavailable" }, 503);
    }

    const phone = normalizeUgPhone(String(body.phone ?? ""));
    if (!phone) return json({ ok: false, error: "invalid_phone" }, 400);

    const { data, error } = await admin.rpc("loyalty_enroll_by_enrollment_token", {
      p_token: token,
      p_name: String(body.name ?? ""),
      p_phone_e164: phone,
      p_email: body.email == null || String(body.email).trim() === "" ? null : String(body.email).trim(),
      p_consent_accepted: Boolean(body.consent),
    });
    if (error) return json({ ok: false, error: "unavailable" }, 503);
    const result = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown>;
    if (!result || result.ok !== true) {
      const err = String(result?.error ?? "unavailable");
      const status =
        err === "already_member" || err === "account_revoked"
          ? 409
          : err === "unavailable" || err === "not_found"
            ? err === "unavailable"
              ? 410
              : 404
            : err === "consent_required" ||
                err === "invalid_name" ||
                err === "invalid_phone" ||
                err === "invalid_email" ||
                err === "token_invalid"
              ? 400
              : 400;
      return json({ ok: false, error: err }, status);
    }

    return json({
      ok: true,
      public_card_token: String(result.public_card_token ?? ""),
      membership_active: result.membership_active !== false,
      membership_expires_on:
        result.membership_expires_on == null ? null : String(result.membership_expires_on),
    });
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
});
