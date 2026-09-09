import { useEffect, useRef, useState } from "react";
import {
  fetchShopHomeKpiOverlay,
  type HomeShopKpiOverlay,
} from "../lib/homeShopKpiOverlay";
import {
  homeKpiOverlayRefreshIdentity,
  type HomeShopKpiOverlayStatus,
} from "../lib/homeKpiTrust";
import { useSyncStatus } from "./useSyncStatus";

type Options = {
  enabled: boolean;
  todayKey: string;
  monthKey: string;
};

export type HomeShopKpiOverlayState = {
  overlay: HomeShopKpiOverlay | null;
  status: HomeShopKpiOverlayStatus;
  /** True when this Home is supposed to show shop-wide RPC totals (online + enabled). */
  expected: boolean;
};

/**
 * Shop-wide Home KPI overlay (online only). Both devices read the same daily/monthly RPCs
 * so Home does not wait for a full IndexedDB sales replica.
 *
 * Failures stay `unavailable` instead of silently falling back to this device's subset.
 * Refetch is keyed on day/month, online, queue idle↔busy, and completed pull/sync
 * timestamps — not every pendingCount tick.
 */
export function useShopHomeKpiOverlay({ enabled, todayKey, monthKey }: Options): HomeShopKpiOverlayState {
  const { isOnline, pendingCount, health } = useSyncStatus();
  const [overlay, setOverlay] = useState<HomeShopKpiOverlay | null>(null);
  const [status, setStatus] = useState<HomeShopKpiOverlayStatus>("idle");
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const active = enabled && isOnline;
  const refreshKey = homeKpiOverlayRefreshIdentity({
    active,
    todayKey,
    monthKey,
    queueIdle: pendingCount === 0,
    lastSuccessAt: health.lastSuccessAt,
    lastPullAt: health.lastPullAt,
  });

  useEffect(() => {
    if (!active) {
      setOverlay(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    if (!overlayRef.current) setStatus("loading");
    const run = () => {
      void fetchShopHomeKpiOverlay(todayKey, monthKey).then((result) => {
        if (cancelled) return;
        if (result.status === "ok") {
          setOverlay(result.overlay);
          setStatus("ready");
          return;
        }
        if (result.status === "skipped") {
          setOverlay(null);
          setStatus("idle");
          return;
        }
        if (!overlayRef.current) {
          setOverlay(null);
          setStatus("unavailable");
        }
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
  }, [active, refreshKey, todayKey, monthKey]);

  return { overlay, status, expected: active };
}
