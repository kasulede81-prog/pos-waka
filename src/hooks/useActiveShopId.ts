import { useEffect, useState } from "react";
import { resolveActiveShopId } from "../lib/ai/businessSetupAi";

export function useActiveShopId() {
  const [shopId, setShopId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void resolveActiveShopId().then((id) => {
      if (cancelled) return;
      setShopId(id);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { shopId, loading };
}
