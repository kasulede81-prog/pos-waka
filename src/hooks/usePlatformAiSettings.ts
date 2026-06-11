import { useCallback, useEffect, useState } from "react";
import { canUseAiAllowed } from "../lib/ai/canUseAi";
import type { AiFeatureName } from "../lib/ai/aiFeatures";
import {
  DEFAULT_PLATFORM_AI_SETTINGS_V2,
  type PlatformAiSettingsV2,
} from "../lib/ai/platformAiSettings.v2";
import { fetchPlatformAiSettings } from "../lib/ai/platformAiSettings";

export function usePlatformAiSettings() {
  const [settings, setSettings] = useState<PlatformAiSettingsV2>(DEFAULT_PLATFORM_AI_SETTINGS_V2);
  const [loading, setLoading] = useState(true);
  const [fromServer, setFromServer] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    const result = await fetchPlatformAiSettings(force);
    setSettings(result.settings);
    setFromServer(result.fromServer);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChange = () => {
      void load(true);
    };
    window.addEventListener("waka:ai-settings-changed", onChange);
    return () => window.removeEventListener("waka:ai-settings-changed", onChange);
  }, [load]);

  const canUse = useCallback(
    (feature: AiFeatureName) => canUseAiAllowed(feature, settings),
    [settings],
  );

  return {
    settings,
    loading,
    fromServer,
    enabled: settings.enabled,
    productAssistantEnabled: canUseAiAllowed("product_assistant", settings),
    inventoryAssistantEnabled: canUseAiAllowed("inventory_assistant", settings),
    businessSetupEnabled: canUseAiAllowed("business_setup_assistant", settings),
    canUse,
    refetch: () => load(true),
  };
}
