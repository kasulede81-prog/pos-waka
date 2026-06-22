import { useCallback, useEffect, useState } from "react";
import {
  buildDefaultPublicPricing,
  type PublicPricingSnapshot,
} from "../lib/subscriptionPricing";
import { fetchPublicSubscriptionPricing } from "../lib/pricingCampaignsAdmin";

export function usePublicPricing() {
  const [pricing, setPricing] = useState<PublicPricingSnapshot>(buildDefaultPublicPricing);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const snap = await fetchPublicSubscriptionPricing();
    setPricing(snap);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { pricing, loading, reload };
}
