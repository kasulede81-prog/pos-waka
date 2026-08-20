import { useEffect, useState } from "react";
import { fetchShopHomeKpiOverlay, type HomeShopKpiOverlay } from "../lib/homeShopKpiOverlay";
import { useSyncStatus } from "./useSyncStatus";

type Options = {
  enabled: boolean;
  todayKey: string;
  monthKey: string;
};

/**
 * Shop-wide Home KPI overlay (online only). Both devices read the same daily/monthly RPCs
 * so Home does not wait for a full IndexedDB sales replica.
 */
export function useShopHomeKpiOverlay({ enabled, todayKey, monthKey }: Options): HomeShopKpiOverlay | null {
  const { isOnline, pendingCount, health } = useSyncStatus();
  const [overlay, setOverlay] = useState<HomeShopKpiOverlay | null>(null);
  const active = enabled && isOnline;

  useEffect(() => {
    if (!active) {
      setOverlay(null);
      return;
    }
    let cancelled = false;
    const run = () => {
      void fetchShopHomeKpiOverlay(todayKey, monthKey)
        .then((next) => {
          if (!cancelled) setOverlay(next);
        })
        .catch(() => {
          if (!cancelled) setOverlay(null);
        });
    };
    run();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = window.setInterval(run, 30_000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(intervalId);
    };
  }, [active, todayKey, monthKey, pendingCount, health.lastSuccessAt, health.lastPullAt]);

  return overlay;
}
