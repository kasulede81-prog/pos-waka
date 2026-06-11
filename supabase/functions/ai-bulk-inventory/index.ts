import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAiFeatureAllowed } from "../_shared/aiGuard.ts";
import { resolveShopIdForUser } from "../_shared/aiContext.ts";
import { aiBlocked, aiFailure, aiSuccess, cors } from "../_shared/aiResponse.ts";
import { logAiRequest } from "../_shared/aiUsage.ts";
import { deepseekModelFromSettings } from "../_shared/platformAiSettings.v2.ts";
import { callDeepSeekBulkInventory } from "../_shared/deepseekClient.ts";

const FEATURE = "inventory_assistant";

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

  let body: { shop_description?: string; business_type?: string };
  try {
    body = await req.json();
  } catch {
    return aiFailure("Invalid body", "invalid_body", 400);
  }

  const shopDescription = String(body.shop_description ?? "").trim();
  const businessType = body.business_type != null ? String(body.business_type).trim() : "";

  if (!shopDescription || shopDescription.length > 500) {
    return aiFailure("Invalid shop description", "invalid_shop_description", 400);
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
  const shopId = await resolveShopIdForUser(admin, userId);

  const guard = await assertAiFeatureAllowed(admin, FEATURE, { userId, shopId }, false);
  if (!guard.allowed) {
    return aiBlocked(guard.reason, guard.code);
  }

  if (!deepseekKey) {
    return aiFailure("DeepSeek not configured", "deepseek_not_configured", 503);
  }

  let result;
  try {
    result = await callDeepSeekBulkInventory({
      apiKey: deepseekKey,
      model: deepseekModelFromSettings(guard.settings),
      shopDescription,
      businessType,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "deepseek_failed";
    await logAiRequest(admin, {
      shopId,
      userId,
      feature: FEATURE,
      kind: "bulk_inventory",
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

  await logAiRequest(admin, {
    shopId,
    userId,
    feature: FEATURE,
    kind: "bulk_inventory",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    cacheHit: false,
    success: true,
    latencyMs: Date.now() - started,
    provider: guard.settings.provider,
  });

  return aiSuccess({
    products: result.products,
    count: result.products.length,
  });
});
