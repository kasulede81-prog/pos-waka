import { useEffect, useState } from "react";
import { useSubscription } from "../context/SubscriptionContext";
import type { ShopVisionSettings } from "../lib/vision/shopVisionSettings";
import { fetchShopVisionSettingsForMember } from "../lib/vision/shopVisionAdmin";
import { resolveVisionAccess, type VisionAccess, type VisionAuthMode } from "../lib/vision/canUseVision";
import { useActiveShopId } from "./useActiveShopId";

export function useShopVisionSettings() {
  const { shopId, loading: shopLoading } = useActiveShopId();
  const { snapshot, authMode: subAuthMode, loading: subLoading } = useSubscription();
  const [settings, setSettings] = useState<ShopVisionSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (shopLoading) return;
    if (!shopId) {
      setSettings(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchShopVisionSettingsForMember(shopId).then((row) => {
      if (cancelled) return;
      setSettings(row);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [shopId, shopLoading]);

  const visionAuth: VisionAuthMode =
    subAuthMode === "local" || snapshot.kind === "local_full" ? "local_bypass" : "cloud";

  const access: VisionAccess = resolveVisionAccess({
    settings,
    shopId,
    authMode: visionAuth,
    snapshot,
  });

  return {
    shopId,
    settings,
    loading: shopLoading || loading || subLoading,
    access,
  };
}
