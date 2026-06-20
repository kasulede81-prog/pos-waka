import { useCallback } from "react";
import { prefetchBusinessSetupTemplates } from "../lib/ai/businessSetupPrefetch";
import { useAiFeatureGate } from "./useAiFeatureGate";

/** Starts AI business-setup generation in the background (no UI). */
export function useSilentAiBusinessSetupPrefetch(params: { enabled?: boolean }) {
  const { enabled: featureOn } = useAiFeatureGate("business_setup_assistant");
  const active = featureOn && params.enabled !== false;

  const prefetch = useCallback(
    (input: { shopName: string; businessType: string; businessDescription?: string }) => {
      if (!active || !input.shopName.trim() || !input.businessType.trim()) return;
      void prefetchBusinessSetupTemplates(input).catch(() => {
        /* silent — products step shows fallback */
      });
    },
    [active],
  );

  return { prefetch, featureOn: active };
}
