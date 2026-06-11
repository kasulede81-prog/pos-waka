import { useCallback, useRef, useState } from "react";
import type { AiProductSuggestion } from "../lib/ai/aiProductSchemas";
import { lookupLocalProductAiCache, upsertLocalProductAiCache } from "../lib/ai/productAiCache";
import {
  mapAiSuggestionToWizardPrefill,
  type WizardPrefillFromAi,
} from "../lib/ai/mapAiSuggestionToWizard";
import { suggestProductWithAi } from "../lib/ai/productAiSuggest";
import { canUseAiAllowed } from "../lib/ai/canUseAi";
import { usePlatformAiSettings } from "./usePlatformAiSettings";

export type AiSuggestOutcome =
  | { ok: true; prefill: WizardPrefillFromAi; fromCache: boolean; suggestion: AiProductSuggestion }
  | { ok: false; error: string; errorCode?: string };

export function useAiProductSuggest() {
  const { settings } = usePlatformAiSettings();
  const productAssistantEnabled = canUseAiAllowed("product_assistant", settings);
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
      if (!productAssistantEnabled) {
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
    [productAssistantEnabled, settings],
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
