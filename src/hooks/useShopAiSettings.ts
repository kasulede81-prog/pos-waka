import { useCallback, useEffect, useState } from "react";
import { fetchShopAiSettingsForMember } from "../lib/ai/shopAiAdmin";
import type { ShopAiSettings } from "../lib/ai/shopAiSettings";

export function useShopAiSettings(shopId: string | null | undefined) {
  const [settings, setSettings] = useState<ShopAiSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) {
      setSettings(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const row = await fetchShopAiSettingsForMember(shopId);
    setSettings(row);
    setLoading(false);
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { settings, loading, refetch: load };
}
