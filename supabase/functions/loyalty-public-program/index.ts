import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  enforceEnrollSubmitRateLimit,
  enforceProgramLookupRateLimit,
} from "../_shared/loyaltyWallet/publicCardDurableRateLimit.ts";

/**
 * Public DKASU Loyalty Program code lookup and join (WPL2026001).
 *
 * GET  ?code=WPL2026001                            → merchant identity preview (no ids, no PII)
 * POST { code, name, phone, email?, consent }      → create a PENDING enrollment request
 *
 * Authority: CODE → loyalty_programs → shop. The client never supplies shop_id or account_id, and
 * there is no parameter through which it could.
 *
 * This is the ONLY route to the code lookup. The database functions behind it are service-role
 * only — `anon` and `authenticated` cannot execute them — so the rate limit below is not a nicety
 * bolted onto an open endpoint, it is the control that stops `WPL2026###` being walked as a
 * merchant directory. A card or enrollment token is 2^256; a code is 999.
 *
 * Posting a code does NOT create a member. It queues a request a merchant must approve, exactly as
 * the enrollment-link path already does. Authentication identifies the customer; a code only
 * identifies the merchant.
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

/** Same shape the database CHECK enforces. Malformed input never reaches the database. */
const PROGRAM_CODE_RE = /^WPL[0-9]{4}[0-9]{3,9}$/;

function normalizeCode(raw: unknown): string | null {
  const v = String(raw ?? "").trim().toUpperCase();
  return PROGRAM_CODE_RE.test(v) ? v : null;
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

  // ------------------------------------------------------------------ preview
  if (req.method === "GET") {
    const url = new URL(req.url);
    const raw = (url.searchParams.get("code") ?? "").trim();
    const code = normalizeCode(raw);

    const rate = await enforceProgramLookupRateLimit(req, supabaseUrl, serviceKey, code);
    if (!rate.ok) {
      if (rate.error === "rate_limited") {
        return json(
          { ok: false, error: "rate_limited", retry_after_seconds: rate.retryAfterSeconds },
          429,
        );
      }
      return json({ ok: false, error: "unavailable" }, 503);
    }

    // A malformed code gets the SAME answer as an unknown one — the endpoint is not an oracle for
    // probing or typos. The database applies the same rule for codes that look well-formed.
    if (!code) return json({ ok: false, error: "not_found" }, 404);

    const { data, error } = await admin.rpc("loyalty_program_public_preview", { p_code: code });
    if (error) return json({ ok: false, error: "unavailable" }, 503);
    const body = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown>;
    if (!body || body.ok !== true) {
      const err = String(body?.error ?? "not_found");
      return json({ ok: false, error: err }, err === "unavailable" ? 410 : 404);
    }

    // Rebuilt field by field rather than spread: an accidental addition to the RPC cannot leak
    // through this boundary. No shop_id, organization_id, account/member/customer id, phone,
    // email, token or member count exists in this payload.
    return json({
      ok: true,
      code: String(body.code ?? ""),
      program_name: String(body.program_name ?? ""),
      shop_name: String(body.shop_name ?? ""),
      district: body.district == null ? null : String(body.district),
      business_type: body.business_type == null ? null : String(body.business_type),
      enabled: Boolean(body.enabled),
    });
  }

  // ------------------------------------------------------- request enrollment
  if (req.method === "POST") {
    let body: {
      code?: string;
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

    // Explicitly ignored: a caller naming a shop or an account achieves nothing. Kept as visible
    // no-ops so the intent is obvious to the next reader.
    void body.shop_id;
    void body.account_id;
    void body.points;
    void body.balance;

    const code = normalizeCode(body.code);
    if (!code) return json({ ok: false, error: "code_invalid" }, 400);

    // Reuses the enrollment SUBMIT scope: joining by code and joining by link are the same act and
    // must share one abuse budget.
    const rate = await enforceEnrollSubmitRateLimit(req, supabaseUrl, serviceKey, code);
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

    const { data, error } = await admin.rpc("loyalty_request_enrollment_by_code", {
      p_code: code,
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
        err === "account_revoked"
          ? 409
          : err === "unavailable"
            ? 410
            : err === "not_found"
              ? 404
              : 400;
      return json({ ok: false, error: err }, status);
    }

    // `pending` (new or already queued) and `already_member` are both card-free outcomes. Still no
    // qr_token, account_id, shop_id or card token.
    return json({
      ok: true,
      status: result.status === "already_member" ? "already_member" : "pending",
      already_requested: result.already_requested === true,
    });
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
});
