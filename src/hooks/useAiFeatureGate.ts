import { useMemo } from "react";
import type { AiFeatureName } from "../lib/ai/aiFeatures";
import { canUseAi, canUseAiAllowed } from "../lib/ai/canUseAi";
import { useActiveShopId } from "./useActiveShopId";
import { usePlatformAiSettings } from "./usePlatformAiSettings";
import { useShopAiSettings } from "./useShopAiSettings";
import { useSessionActor } from "../context/SessionActorContext";

/** Combined platform + shop + role AI gate for POS features. */
export function useAiFeatureGate(feature: AiFeatureName) {
  const { settings, loading: platformLoading } = usePlatformAiSettings();
  const { shopId, loading: shopIdLoading } = useActiveShopId();
  const { settings: shopSettings, loading: shopSettingsLoading } = useShopAiSettings(shopId);
  const actor = useSessionActor();

  const loading = platformLoading || shopIdLoading || shopSettingsLoading;

  const result = useMemo(
    () => canUseAi(feature, { settings, shopSettings, userRole: actor.role }),
    [feature, settings, shopSettings, actor.role],
  );

  return {
    allowed: result.allowed,
    enabled: result.allowed,
    reason: result.allowed ? null : result.reason,
    code: result.allowed ? null : result.code,
    loading,
    shopId,
    shopSettings,
    platformSettings: settings,
  };
}

export function useAiFeatureGates(features: AiFeatureName[]) {
  const { settings, loading: platformLoading } = usePlatformAiSettings();
  const { shopId, loading: shopIdLoading } = useActiveShopId();
  const { settings: shopSettings, loading: shopSettingsLoading } = useShopAiSettings(shopId);
  const actor = useSessionActor();

  const loading = platformLoading || shopIdLoading || shopSettingsLoading;

  const gates = useMemo(() => {
    const map = {} as Record<AiFeatureName, boolean>;
    for (const f of features) {
      map[f] = canUseAiAllowed(f, settings, shopSettings, actor.role);
    }
    return map;
  }, [features, settings, shopSettings, actor.role]);

  return { gates, loading, shopId, shopSettings, platformSettings: settings };
}
