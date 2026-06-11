/**
 * AI error codes and user-facing messages.
 * Development builds show diagnostic detail; production stays friendly.
 */

export type AiErrorCode =
  | "function_not_deployed"
  | "deepseek_not_configured"
  | "ai_platform_disabled"
  | "feature_disabled"
  | "pilot_not_approved"
  | "shop_ai_disabled"
  | "shop_feature_disabled"
  | "shop_monthly_limit_reached"
  | "permission_check_failed"
  | "settings_unavailable"
  | "rpc_missing"
  | "monthly_request_limit_reached"
  | "monthly_budget_limit_reached"
  | "per_shop_limit_reached"
  | "per_user_limit_reached"
  | "provider_not_configured"
  | "ai_provider_failed"
  | "deepseek_error"
  | "invalid_schema"
  | "cache_lookup_failed"
  | "unauthorized"
  | "invoke_failed"
  | "timeout"
  | "ai_disabled"
  | "invalid_product_name"
  | "server_misconfigured"
  | "unknown";

const FRIENDLY: Record<string, string> = {
  function_not_deployed: "Couldn't get suggestions. You can still add the product yourself.",
  deepseek_not_configured: "Couldn't get suggestions. You can still add the product yourself.",
  ai_platform_disabled: "Couldn't get suggestions. You can still add the product yourself.",
  feature_disabled: "Couldn't get suggestions. You can still add the product yourself.",
  pilot_not_approved: "Couldn't get suggestions. You can still add the product yourself.",
  shop_ai_disabled: "Couldn't get suggestions. You can still add the product yourself.",
  shop_feature_disabled: "Couldn't get suggestions. You can still add the product yourself.",
  shop_monthly_limit_reached: "AI is temporarily unavailable. Try again later or add the product manually.",
  permission_check_failed: "Couldn't get suggestions. You can still add the product yourself.",
  settings_unavailable: "Couldn't get suggestions. You can still add the product yourself.",
  rpc_missing: "Couldn't get suggestions. You can still add the product yourself.",
  monthly_request_limit_reached: "AI is temporarily unavailable. Try again later or add the product manually.",
  monthly_budget_limit_reached: "AI is temporarily unavailable. Try again later or add the product manually.",
  per_shop_limit_reached: "AI is temporarily unavailable. Try again later or add the product manually.",
  per_user_limit_reached: "AI is temporarily unavailable. Try again later or add the product manually.",
  provider_not_configured: "Couldn't get suggestions. You can still add the product yourself.",
  ai_provider_failed: "Couldn't get suggestions. You can still add the product yourself.",
  deepseek_error: "Couldn't get suggestions. You can still add the product yourself.",
  invalid_schema: "Couldn't get suggestions. You can still add the product yourself.",
  cache_lookup_failed: "Couldn't get suggestions. You can still add the product yourself.",
  unauthorized: "Couldn't get suggestions. You can still add the product yourself.",
  invoke_failed: "Couldn't get suggestions. You can still add the product yourself.",
  timeout: "Request timed out. Check your connection and try again.",
  ai_disabled: "AI assistant is disabled.",
  invalid_product_name: "Enter a product name first.",
  server_misconfigured: "Couldn't get suggestions. You can still add the product yourself.",
  unknown: "Couldn't get suggestions. You can still add the product yourself.",
};

const DEV_LABEL: Record<string, string> = {
  function_not_deployed: "Function not deployed",
  deepseek_not_configured: "Missing API key",
  ai_platform_disabled: "AI disabled",
  feature_disabled: "AI feature disabled",
  pilot_not_approved: "Shop not approved for AI pilot",
  shop_ai_disabled: "Shop AI disabled",
  shop_feature_disabled: "Feature disabled for shop",
  shop_monthly_limit_reached: "Shop rate limit reached",
  permission_check_failed: "Permission check failed",
  settings_unavailable: "AI settings unavailable",
  rpc_missing: "RPC missing",
  monthly_request_limit_reached: "Rate limit reached",
  monthly_budget_limit_reached: "Monthly budget limit reached",
  per_shop_limit_reached: "Shop rate limit reached",
  per_user_limit_reached: "User rate limit reached",
  provider_not_configured: "AI provider not configured",
  ai_provider_failed: "DeepSeek error",
  deepseek_error: "DeepSeek error",
  invalid_schema: "Response failed schema validation",
  cache_lookup_failed: "Cache lookup failed",
  unauthorized: "Unauthorized",
  invoke_failed: "Edge invoke failed",
  timeout: "Request timed out",
  ai_disabled: "AI disabled",
  invalid_product_name: "Invalid product name",
  server_misconfigured: "Server misconfigured",
  unknown: "Unknown AI error",
};

export function isAiDevDiagnosticsEnabled(): boolean {
  return import.meta.env.DEV;
}

export function normalizeAiErrorCode(code?: string | null, message?: string | null): AiErrorCode {
  const raw = String(code ?? "").trim().toLowerCase();
  const msg = String(message ?? "").toLowerCase();

  if (raw === "function_not_deployed" || msg.includes("deploy supabase edge function")) {
    return "function_not_deployed";
  }
  if (raw === "deepseek_not_configured") return "deepseek_not_configured";
  if (raw === "ai_platform_disabled" || raw === "ai_disabled") return "ai_platform_disabled";
  if (raw === "feature_disabled") return "feature_disabled";
  if (raw === "pilot_not_approved") return "pilot_not_approved";
  if (raw === "shop_ai_disabled") return "shop_ai_disabled";
  if (raw === "shop_feature_disabled") return "shop_feature_disabled";
  if (raw === "shop_monthly_limit_reached") return "shop_monthly_limit_reached";
  if (raw === "permission_check_failed") return "permission_check_failed";
  if (raw === "settings_unavailable") return "settings_unavailable";
  if (raw === "monthly_request_limit_reached") return "monthly_request_limit_reached";
  if (raw === "monthly_budget_limit_reached") return "monthly_budget_limit_reached";
  if (raw === "per_shop_limit_reached") return "per_shop_limit_reached";
  if (raw === "per_user_limit_reached") return "per_user_limit_reached";
  if (raw === "provider_not_configured") return "provider_not_configured";
  if (raw === "ai_provider_failed" || raw.startsWith("deepseek_http_") || msg.startsWith("deepseek_http_")) {
    return "deepseek_error";
  }
  if (raw.startsWith("deepseek_") || msg.includes("deepseek")) return "deepseek_error";
  if (raw === "invalid_schema" || raw === "deepseek_invalid_json" || raw === "deepseek_invalid_schema") {
    return "invalid_schema";
  }
  if (raw === "cache_lookup_failed") return "cache_lookup_failed";
  if (raw === "unauthorized") return "unauthorized";
  if (raw === "invalid_product_name") return "invalid_product_name";
  if (raw === "server_misconfigured") return "server_misconfigured";
  if (msg.includes("timed out")) return "timeout";
  if (
    msg.includes("could not find the function") ||
    msg.includes("function public.") ||
    msg.includes("schema cache") ||
    raw === "rpc_missing"
  ) {
    return "rpc_missing";
  }
  if (raw === "invoke_failed") return "invoke_failed";
  if (raw) return raw as AiErrorCode;
  return "unknown";
}

export function formatAiErrorMessage(params: {
  code?: string | null;
  detail?: string | null;
  /** Override dev diagnostics (defaults to import.meta.env.DEV). */
  devMode?: boolean;
}): string {
  const code = normalizeAiErrorCode(params.code, params.detail);
  if (params.devMode ?? isAiDevDiagnosticsEnabled()) {
    const label = DEV_LABEL[code] ?? DEV_LABEL.unknown;
    const detail = params.detail?.trim();
    if (detail && !detail.toLowerCase().includes(label.toLowerCase())) {
      return `${label}: ${detail}`;
    }
    return label;
  }
  return FRIENDLY[code] ?? FRIENDLY.unknown;
}

export function classifyInvokeMessage(message: string, functionName?: string): AiErrorCode {
  const msg = message.toLowerCase();
  if (
    msg.includes("not found") ||
    msg.includes("404") ||
    msg.includes("requested function was not found") ||
    msg.includes("deploy supabase edge function")
  ) {
    return "function_not_deployed";
  }
  if (msg.includes("timed out")) return "timeout";
  if (functionName && msg.includes(functionName)) return "invoke_failed";
  return normalizeAiErrorCode(null, message);
}
