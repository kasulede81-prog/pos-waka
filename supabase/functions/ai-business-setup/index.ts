import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { AiBusinessSetupResult } from "../_shared/aiBusinessSchemas.ts";
import { assertAiFeatureAllowed } from "../_shared/aiGuard.ts";
import { resolveShopIdForUser } from "../_shared/aiContext.ts";
import { aiBlocked, aiFailure, aiSuccess, cors } from "../_shared/aiResponse.ts";
import { logAiRequest } from "../_shared/aiUsage.ts";
import { deepseekModelFromSettings } from "../_shared/platformAiSettings.v2.ts";
import { callDeepSeekBusinessSetup } from "../_shared/deepseekClient.ts";

const FEATURE = "business_setup_assistant";

function templateFromRow(row: Record<string, unknown>): AiBusinessSetupResult {
  const shelves = Array.isArray(row.shelves) ? row.shelves.map(String) : [];
  const starterRaw = row.starter_products;
  const starterProducts = Array.isArray(starterRaw) ? starterRaw : [];
  return {
    detectedNature: String(row.detected_nature ?? "General Retail"),
    shelves,
    starterProducts: starterProducts as AiBusinessSetupResult["starterProducts"],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const started = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return aiFailure("Server misconfigured", "server_misconfigured", 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return aiFailure("Unauthorized", "unauthorized", 401);
  }

  let body: {
    shop_id?: string;
    shop_name?: string;
    business_type?: string;
    business_description?: string;
    force_regenerate?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return aiFailure("Invalid body", "invalid_body", 400);
  }

  const shopName = String(body.shop_name ?? "").trim();
  const businessType = String(body.business_type ?? "").trim();
  const businessDescription = body.business_description != null ? String(body.business_description).trim() : "";
  const forceRegenerate = body.force_regenerate === true;

  if (!shopName || shopName.length > 200) {
    return aiFailure("Invalid shop name", "invalid_shop_name", 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id) {
    return aiFailure("Unauthorized", "unauthorized", 401);
  }
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);
  const shopId = await resolveShopIdForUser(admin, userId, body.shop_id);

  if (!shopId) {
    return aiFailure("Shop not found", "shop_not_found", 404);
  }

  const { data: shopRow } = await admin
    .from("shops")
    .select("id, organization_id, ai_setup_completed_at")
    .eq("id", shopId)
    .maybeSingle();

  if (!shopRow?.id) {
    return aiFailure("Shop not found", "shop_not_found", 404);
  }

  if (!forceRegenerate && shopRow.ai_setup_completed_at) {
    return aiFailure("Setup already completed", "already_completed", 409);
  }

  const { data: existingTemplate } = await admin
    .from("shop_ai_setup_templates")
    .select("*")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!forceRegenerate && existingTemplate) {
    const setup = templateFromRow(existingTemplate as Record<string, unknown>);
    const guard = await assertAiFeatureAllowed(admin, FEATURE, { userId, shopId }, true);
    if (!guard.allowed) {
      return aiBlocked(guard.reason, guard.code);
    }

    await logAiRequest(admin, {
      shopId,
      userId,
      feature: FEATURE,
      kind: "business_setup",
      tokensIn: 0,
      tokensOut: 0,
      cacheHit: true,
      success: true,
      latencyMs: Date.now() - started,
      provider: guard.settings.provider,
    });

    return aiSuccess({ from_cache: true, shop_id: shopId, setup });
  }

  if (forceRegenerate) {
    const { data: staffRow, error: staffErr } = await userClient.rpc("waka_internal_me");
    if (staffErr || !staffRow) {
      return aiFailure("Forbidden", "forbidden_regenerate", 403);
    }
  }

  const guard = await assertAiFeatureAllowed(admin, FEATURE, { userId, shopId }, false);
  if (!guard.allowed) {
    return aiBlocked(guard.reason, guard.code);
  }

  if (!deepseekKey) {
    return aiFailure("DeepSeek not configured", "deepseek_not_configured", 503);
  }

  let result;
  try {
    result = await callDeepSeekBusinessSetup({
      apiKey: deepseekKey,
      model: deepseekModelFromSettings(guard.settings),
      shopName,
      businessType,
      businessDescription: businessDescription || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "deepseek_failed";
    await logAiRequest(admin, {
      shopId,
      userId,
      feature: FEATURE,
      kind: "business_setup",
      tokensIn: 0,
      tokensOut: 0,
      cacheHit: false,
      success: false,
      latencyMs: Date.now() - started,
      provider: guard.settings.provider,
      errorReason: msg,
    });
    return aiFailure("AI provider failed", "ai_provider_failed", 502);
  }

  const upsertPayload = {
    shop_id: shopId,
    organization_id: shopRow.organization_id,
    detected_nature: result.setup.detectedNature,
    business_description: businessDescription || null,
    shelves: result.setup.shelves,
    starter_products: result.setup.starterProducts,
    model: deepseekModelFromSettings(guard.settings),
    generated_at: new Date().toISOString(),
    regenerated_by: forceRegenerate ? userId : null,
  };

  const { error: upsertErr } = await admin
    .from("shop_ai_setup_templates")
    .upsert(upsertPayload, { onConflict: "shop_id" });

  if (upsertErr) {
    return aiFailure("Template save failed", "template_save_failed", 500);
  }

  if (forceRegenerate) {
    await admin.from("shops").update({ ai_setup_completed_at: null }).eq("id", shopId);
  }

  await logAiRequest(admin, {
    shopId,
    userId,
    feature: FEATURE,
    kind: "business_setup",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    cacheHit: false,
    success: true,
    latencyMs: Date.now() - started,
    provider: guard.settings.provider,
  });

  return aiSuccess({ from_cache: false, shop_id: shopId, setup: result.setup });
});
