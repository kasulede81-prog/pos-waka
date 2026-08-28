import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiFailure, aiJson, cors } from "../_shared/aiResponse.ts";
import {
  EFRIS_PROVIDER_NOT_CONFIGURED,
  isOfficialEfrisProviderConfigured,
} from "../_shared/efrisFailClosed.ts";

/**
 * EFRIS submit stub (Phase 1).
 * Authenticates the caller, verifies shop access and outbox, then fail-closes.
 * Does not call any URA / EFRIS HTTP API. Does not invent endpoints.
 */

const SHOP_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return aiFailure("Server misconfigured", "server_misconfigured", 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return aiFailure("Unauthorized", "unauthorized", 401);
  }

  let body: { shop_id?: string; sale_id?: string };
  try {
    body = await req.json();
  } catch {
    return aiFailure("Invalid body", "invalid_body", 400);
  }

  const shopId = typeof body.shop_id === "string" ? body.shop_id.trim() : "";
  const saleId = typeof body.sale_id === "string" ? body.sale_id.trim() : "";
  if (!SHOP_UUID_RE.test(shopId) || !SHOP_UUID_RE.test(saleId)) {
    return aiFailure("Invalid body", "invalid_body", 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id) {
    return aiFailure("Unauthorized", "unauthorized", 401);
  }

  const { data: canAccess, error: accessErr } = await userClient.rpc("user_can_access_shop", {
    p_shop: shopId,
  });
  if (accessErr || canAccess !== true) {
    return aiFailure("Forbidden", "forbidden", 403);
  }

  const { data: configRaw, error: configErr } = await userClient.rpc("shop_get_efris_config", {
    p_shop_id: shopId,
  });
  if (configErr) {
    return aiFailure("Config lookup failed", "config_lookup_failed", 500);
  }
  const config = configRaw as { ok?: boolean; enabled?: boolean; error?: string } | null;
  if (!config || config.ok === false) {
    return aiFailure("Forbidden", "forbidden", 403);
  }
  if (config.enabled !== true) {
    return aiJson(
      {
        ok: false,
        success: false,
        code: "efris_disabled",
        reason: "EFRIS is disabled for this shop",
        efris_state: "NOT_REQUIRED",
      },
      200,
    );
  }

  const { data: outbox, error: outboxErr } = await userClient
    .from("shop_efris_submissions")
    .select("id, efris_state, shop_id, sale_id")
    .eq("shop_id", shopId)
    .eq("sale_id", saleId)
    .maybeSingle();
  if (outboxErr) {
    return aiFailure("Outbox lookup failed", "outbox_lookup_failed", 500);
  }
  if (!outbox) {
    return aiJson(
      {
        ok: false,
        success: false,
        code: "outbox_not_found",
        reason: "No EFRIS outbox row for this sale",
      },
      404,
    );
  }

  if (isOfficialEfrisProviderConfigured()) {
    return aiFailure("Official provider must not be enabled in Phase 1", "efris_phase1_guard", 500);
  }

  const { data: noted, error: noteErr } = await userClient.rpc("shop_efris_note_provider_absent", {
    p_shop_id: shopId,
    p_sale_id: saleId,
  });
  if (noteErr) {
    return aiJson(
      {
        ok: false,
        success: false,
        code: EFRIS_PROVIDER_NOT_CONFIGURED,
        reason: "Official URA EFRIS provider is not configured",
        efris_state: outbox.efris_state,
        accepted: false,
      },
      503,
    );
  }

  const notedRow = noted as { efris_state?: string } | null;

  return aiJson(
    {
      ok: false,
      success: false,
      code: EFRIS_PROVIDER_NOT_CONFIGURED,
      reason: "Official URA EFRIS provider is not configured",
      efris_state: notedRow?.efris_state ?? outbox.efris_state,
      accepted: false,
      submitted: false,
    },
    503,
  );
});
