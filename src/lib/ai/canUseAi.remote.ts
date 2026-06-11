import { supabase } from "../supabase";
import type { AiFeatureName } from "./aiFeatures";
import type { AiBlockCode, CanUseAiResult } from "./canUseAi";

type RpcResult = {
  allowed?: boolean;
  reason?: string;
  code?: string;
};

/** Server-authoritative permission check before edge invocation. */
export async function checkAiFeatureAllowedRemote(params: {
  feature: AiFeatureName;
  shopId?: string | null;
  userId?: string | null;
  cacheHit?: boolean;
}): Promise<CanUseAiResult> {
  if (!supabase) {
    return { allowed: false, reason: "Offline — AI unavailable.", code: "ai_platform_disabled" };
  }

  const { data, error } = await supabase.rpc("check_ai_feature_allowed", {
    p_feature: params.feature,
    p_shop_id: params.shopId ?? null,
    p_user_id: params.userId ?? null,
    p_cache_hit: params.cacheHit === true,
  });

  if (error) {
    return { allowed: false, reason: error.message, code: "ai_platform_disabled" };
  }

  const row = (data ?? {}) as RpcResult;
  if (row.allowed === true) return { allowed: true };

  const code = (row.code as AiBlockCode | undefined) ?? "feature_disabled";
  return {
    allowed: false,
    reason: String(row.reason ?? "AI feature disabled"),
    code,
  };
}
