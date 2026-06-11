import { useCallback, useEffect, useRef, useState } from "react";
import type { AiBusinessSetupResult } from "../lib/ai/aiBusinessSchemas";
import {
  fetchShopAiSetupCompleted,
  fetchShopAiSetupTemplate,
  finalizeShopAiSetup,
  generateBusinessSetupWithAi,
  resolveActiveShopId,
} from "../lib/ai/businessSetupAi";
import { canUseAiAllowed } from "../lib/ai/canUseAi";
import { usePlatformAiSettings } from "./usePlatformAiSettings";

export function useAiBusinessSetup(params: {
  shopName: string;
  businessType: string;
  businessDescription?: string;
  enabled?: boolean;
}) {
  const { settings } = usePlatformAiSettings();
  const featureOn = canUseAiAllowed("business_setup_assistant", settings) && params.enabled !== false;

  const [shopId, setShopId] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [setup, setSetup] = useState<AiBusinessSetupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const booted = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (!featureOn) return;
    const sid = await resolveActiveShopId();
    setShopId(sid);
    if (!sid) return;
    const done = await fetchShopAiSetupCompleted(sid);
    setCompleted(done);
    if (done) return;
    const cached = await fetchShopAiSetupTemplate(sid);
    if (cached) {
      setSetup(cached);
      setFromCache(true);
    }
  }, [featureOn]);

  useEffect(() => {
    if (!featureOn || booted.current) return;
    booted.current = true;
    void refreshStatus();
  }, [featureOn, refreshStatus]);

  const generate = useCallback(async () => {
    if (!featureOn) return null;
    setLoading(true);
    setError(null);
    try {
      const result = await generateBusinessSetupWithAi({
        shopId,
        shopName: params.shopName,
        businessType: params.businessType,
        businessDescription: params.businessDescription,
      });
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      setShopId(result.shopId || shopId);
      setSetup(result.setup);
      setFromCache(result.fromCache);
      return result.setup;
    } finally {
      setLoading(false);
    }
  }, [featureOn, shopId, params.shopName, params.businessType, params.businessDescription]);

  const skip = useCallback(async () => {
    const sid = shopId ?? (await resolveActiveShopId());
    if (sid) await finalizeShopAiSetup(sid, true);
    setCompleted(true);
    setSetup(null);
  }, [shopId]);

  const accept = useCallback(async () => {
    const sid = shopId ?? (await resolveActiveShopId());
    if (sid) await finalizeShopAiSetup(sid, false);
    setCompleted(true);
  }, [shopId]);

  return {
    featureOn,
    shopId,
    completed,
    setup,
    loading,
    error,
    fromCache,
    generate,
    skip,
    accept,
    refreshStatus,
  };
}
