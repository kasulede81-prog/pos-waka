import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parsePlatformAiSettingsV2 } from "./platformAiSettings.v2.ts";

export type AiGuardContext = {
  userId: string;
  shopId: string | null;
};

export type AiGuardResult =
  | { allowed: true; settings: ReturnType<typeof parsePlatformAiSettingsV2> }
  | { allowed: false; reason: string; code: string };

export async function assertAiFeatureAllowed(
  admin: SupabaseClient,
  feature: string,
  ctx: AiGuardContext,
  cacheHit = false,
): Promise<AiGuardResult> {
  const { data: settingsRaw, error: settingsErr } = await admin.rpc("get_platform_ai_settings");
  if (settingsErr) {
    return { allowed: false, reason: "Settings unavailable", code: "settings_unavailable" };
  }

  const settings = parsePlatformAiSettingsV2(settingsRaw);

  const { data: checkRaw, error: checkErr } = await admin.rpc("check_ai_feature_allowed", {
    p_feature: feature,
    p_shop_id: ctx.shopId,
    p_user_id: ctx.userId,
    p_cache_hit: cacheHit,
  });

  if (checkErr) {
    return { allowed: false, reason: "Permission check failed", code: "permission_check_failed" };
  }

  const check = (checkRaw ?? {}) as { allowed?: boolean; reason?: string; code?: string };
  if (check.allowed !== true) {
    return {
      allowed: false,
      reason: String(check.reason ?? "AI feature disabled"),
      code: String(check.code ?? "feature_disabled"),
    };
  }

  if (settings.provider !== "deepseek") {
    return { allowed: false, reason: "AI provider is not configured", code: "provider_not_configured" };
  }

  return { allowed: true, settings };
}
