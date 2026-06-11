import { useCallback, useRef, useState } from "react";
import type { AiProductSuggestion } from "../lib/ai/aiProductSchemas";
import { lookupLocalProductAiCache, upsertLocalProductAiCache } from "../lib/ai/productAiCache";
import {
  mapAiSuggestionToWizardPrefill,
  type WizardPrefillFromAi,
} from "../lib/ai/mapAiSuggestionToWizard";
import { suggestProductWithAi } from "../lib/ai/productAiSuggest";
import { useAiFeatureGate } from "./useAiFeatureGate";

export type AiSuggestOutcome =
  | { ok: true; prefill: WizardPrefillFromAi; fromCache: boolean; suggestion: AiProductSuggestion }
  | { ok: false; error: string; errorCode?: string };

export function useAiProductSuggest() {
  const { enabled: productAssistantEnabled, loading: gateLoading } =
    useAiFeatureGate("product_assistant");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const inflight = useRef(new Map<string, Promise<AiSuggestOutcome>>());

  const reset = useCallback(() => {
    setError(null);
    setErrorCode(null);
    setLoading(false);
  }, []);

  const suggest = useCallback(
    async (params: {
      productName: string;
      businessType?: string | null;
    }): Promise<AiSuggestOutcome> => {
      // While the gate is still loading we let the request through; the edge
      // function re-checks permissions server-side and is authoritative.
      if (!productAssistantEnabled && !gateLoading) {
        return { ok: false, error: "AI assistant is disabled.", errorCode: "ai_disabled" };
      }

      const name = params.productName.trim();
      if (!name) {
        return { ok: false, error: "Product name is required.", errorCode: "invalid_product_name" };
      }

      const businessType = params.businessType ?? "";
      const dedupeKey = `${name.toLowerCase()}::${String(businessType)}`;
      const existing = inflight.current.get(dedupeKey);
      if (existing) return existing;

      const run = (async (): Promise<AiSuggestOutcome> => {
        setLoading(true);
        setError(null);
        setErrorCode(null);
        try {
          const local = await lookupLocalProductAiCache(name, String(businessType));
          if (local) {
            return {
              ok: true,
              prefill: mapAiSuggestionToWizardPrefill(local),
              fromCache: true,
              suggestion: local,
            };
          }

          const remote = await suggestProductWithAi({
            productName: name,
            businessType: String(businessType),
          });

          if (!remote.ok) {
            setError(remote.error);
            setErrorCode(remote.errorCode ?? null);
            return { ok: false, error: remote.error, errorCode: remote.errorCode };
          }

          await upsertLocalProductAiCache(name, String(businessType), remote.suggestion);

          return {
            ok: true,
            prefill: mapAiSuggestionToWizardPrefill(remote.suggestion),
            fromCache: remote.fromCache,
            suggestion: remote.suggestion,
          };
        } finally {
          setLoading(false);
          inflight.current.delete(dedupeKey);
        }
      })();

      inflight.current.set(dedupeKey, run);
      return run;
    },
    [productAssistantEnabled, gateLoading],
  );

  return {
    enabled: productAssistantEnabled,
    loading,
    error,
    errorCode,
    suggest,
    reset,
  };
}
