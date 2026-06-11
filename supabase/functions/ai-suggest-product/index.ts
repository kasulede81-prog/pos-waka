import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAiFeatureAllowed } from "../_shared/aiGuard.ts";
import { resolveShopIdForUser } from "../_shared/aiContext.ts";
import { aiBlocked, aiFailure, aiSuccess, cors } from "../_shared/aiResponse.ts";
import { logAiRequest } from "../_shared/aiUsage.ts";
import { deepseekModelFromSettings } from "../_shared/platformAiSettings.v2.ts";
import {
  cacheRowToSuggestion,
  normalizeProductNameKey,
  suggestionToCachePayload,
} from "../_shared/aiProductSchemas.ts";
import { callDeepSeekProductSuggest } from "../_shared/deepseekClient.ts";

const FEATURE = "product_assistant";

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

  let body: { product_name?: string; business_type?: string };
  try {
    body = await req.json();
  } catch {
    return aiFailure("Invalid body", "invalid_body", 400);
  }

  const productName = String(body.product_name ?? "").trim();
  if (!productName || productName.length > 200) {
    return aiFailure("Invalid product name", "invalid_product_name", 400);
  }
  const businessType = body.business_type != null ? String(body.business_type).trim() : "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id) {
    return aiFailure("Unauthorized", "unauthorized", 401);
  }
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);
  const shopId = await resolveShopIdForUser(admin, userId);

  const guard = await assertAiFeatureAllowed(admin, FEATURE, { userId, shopId }, true);
  if (!guard.allowed) {
    return aiBlocked(guard.reason, guard.code);
  }

  const normalized = normalizeProductNameKey(productName);
  if (!normalized) {
    return aiFailure("Invalid product name", "invalid_product_name", 400);
  }

  const { data: cacheHit, error: cacheErr } = await admin.rpc("lookup_product_ai_cache", {
    p_product_name_normalized: normalized,
    p_business_type: businessType || null,
  });
  if (cacheErr) {
    return aiFailure("Cache lookup failed", "cache_lookup_failed", 500);
  }

  const cacheObj = (cacheHit ?? {}) as Record<string, unknown>;
  if (cacheObj.found === true) {
    const suggestion = cacheRowToSuggestion(cacheObj, String(cacheObj.product_name_display ?? productName));

    await logAiRequest(admin, {
      shopId,
      userId,
      feature: FEATURE,
      kind: "product_suggest",
      tokensIn: 0,
      tokensOut: 0,
      cacheHit: true,
      success: true,
      latencyMs: Date.now() - started,
      provider: guard.settings.provider,
    });

    return aiSuccess({
      from_cache: true,
      suggestion,
      confidence: suggestion.confidence,
    });
  }

  const providerGuard = await assertAiFeatureAllowed(admin, FEATURE, { userId, shopId }, false);
  if (!providerGuard.allowed) {
    return aiBlocked(providerGuard.reason, providerGuard.code);
  }

  if (!deepseekKey) {
    return aiFailure("DeepSeek not configured", "deepseek_not_configured", 503);
  }

  let result;
  try {
    result = await callDeepSeekProductSuggest({
      apiKey: deepseekKey,
      model: deepseekModelFromSettings(providerGuard.settings),
      productName,
      businessType: businessType || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "deepseek_failed";
    await logAiRequest(admin, {
      shopId,
      userId,
      feature: FEATURE,
      kind: "product_suggest",
      tokensIn: 0,
      tokensOut: 0,
      cacheHit: false,
      success: false,
      latencyMs: Date.now() - started,
      provider: providerGuard.settings.provider,
      errorReason: msg,
    });
    return aiFailure("AI provider failed", "ai_provider_failed", 502);
  }

  await admin.rpc("upsert_product_ai_cache", {
    p_product_name_normalized: normalized,
    p_product_name_display: result.suggestion.name,
    p_business_type: businessType || null,
    p_payload: suggestionToCachePayload(result.suggestion),
  });

  await logAiRequest(admin, {
    shopId,
    userId,
    feature: FEATURE,
    kind: "product_suggest",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    cacheHit: false,
    success: true,
    latencyMs: Date.now() - started,
    provider: providerGuard.settings.provider,
  });

  return aiSuccess({
    from_cache: false,
    suggestion: result.suggestion,
    confidence: result.suggestion.confidence,
  });
});
