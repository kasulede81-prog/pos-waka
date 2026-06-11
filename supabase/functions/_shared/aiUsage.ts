/** DeepSeek-chat approximate USD pricing per 1M tokens */
const DEEPSEEK_INPUT_PER_1M = 0.14;
const DEEPSEEK_OUTPUT_PER_1M = 0.28;

export function estimateProviderCostUsd(tokensIn: number, tokensOut: number, provider = "deepseek"): number {
  if (provider !== "deepseek") return 0;
  const input = Math.max(0, tokensIn) / 1_000_000 * DEEPSEEK_INPUT_PER_1M;
  const output = Math.max(0, tokensOut) / 1_000_000 * DEEPSEEK_OUTPUT_PER_1M;
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}

export async function logAiRequest(
  admin: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }> },
  params: {
    shopId: string | null;
    userId: string | null;
    feature: string;
    kind: string;
    tokensIn: number;
    tokensOut: number;
    cacheHit: boolean;
    success: boolean;
    latencyMs: number | null;
    provider: string;
    errorReason?: string | null;
  },
): Promise<void> {
  const cost = params.cacheHit
    ? 0
    : estimateProviderCostUsd(params.tokensIn, params.tokensOut, params.provider);

  await admin.rpc("log_ai_request", {
    p_shop_id: params.shopId,
    p_user_id: params.userId,
    p_feature: params.feature,
    p_kind: params.kind,
    p_tokens_in: params.tokensIn,
    p_tokens_out: params.tokensOut,
    p_cache_hit: params.cacheHit,
    p_success: params.success,
    p_latency_ms: params.latencyMs,
    p_estimated_cost_usd: cost,
    p_provider: params.provider,
    p_error_reason: params.errorReason ?? null,
  });
}
