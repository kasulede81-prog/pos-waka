import { invokeSupabaseEdgeFunction } from "../supabaseEdgeInvoke";
import { normalizeAiErrorCode } from "./aiErrors";
import { parseAiEdgeFailure } from "./parseAiEdgeResponse";
import { parseAiProductSuggestion, type AiProductSuggestion } from "./aiProductSchemas";

export type ProductAiSuggestResult =
  | { ok: true; suggestion: AiProductSuggestion; fromCache: boolean; confidence: number }
  | { ok: false; error: string; errorCode?: string };

type EdgeResponse = {
  ok?: boolean;
  success?: boolean;
  error?: string;
  reason?: string;
  code?: string;
  from_cache?: boolean;
  suggestion?: unknown;
  confidence?: number;
};

/**
 * Request AI product prefill via Edge Function (cache → DeepSeek).
 * Failures are non-blocking — caller should fall back to manual wizard.
 */
export async function suggestProductWithAi(params: {
  productName: string;
  businessType?: string | null;
}): Promise<ProductAiSuggestResult> {
  const name = params.productName.trim();
  if (!name) return { ok: false, error: "Product name is required.", errorCode: "invalid_product_name" };

  const res = await invokeSupabaseEdgeFunction<EdgeResponse>("ai-suggest-product", {
    product_name: name,
    business_type: params.businessType ?? "",
  });

  if (!res.ok) {
    return {
      ok: false,
      error: res.message,
      errorCode: res.errorCode ?? normalizeAiErrorCode("invoke_failed", res.message),
    };
  }

  const data = res.data;
  const failure = parseAiEdgeFailure(data);
  if (failure.failed) {
    return { ok: false, error: failure.error, errorCode: failure.errorCode };
  }

  const suggestion = parseAiProductSuggestion(data.suggestion, name);
  if (!suggestion) {
    return { ok: false, error: "Invalid AI response.", errorCode: "invalid_schema" };
  }

  return {
    ok: true,
    suggestion,
    fromCache: data.from_cache === true,
    confidence: Number(data.confidence ?? suggestion.confidence),
  };
}
