import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSubscription } from "../context/SubscriptionContext";
import { useOfflineStatus } from "./useOfflineStatus";
import { sendShopPresenceHeartbeat } from "../lib/shopPresence";
import { shouldPausePosBackgroundWork } from "../lib/backgroundWorkPolicy";

const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

/** Keeps shop + device last_seen fresh while the POS app is open and online. */
export function useShopPresenceHeartbeat(): void {
  const location = useLocation();
  const { authMode, snapshot } = useSubscription();
  const { isOnline } = useOfflineStatus();

  const shopId = snapshot.kind === "remote" ? snapshot.row.shop_id : null;
  const paused = shouldPausePosBackgroundWork(location.pathname);

  useEffect(() => {
    if (paused || authMode !== "supabase" || !shopId || !isOnline) return;

    void sendShopPresenceHeartbeat(shopId);

    const id = window.setInterval(() => {
      void sendShopPresenceHeartbeat(shopId);
    }, HEARTBEAT_INTERVAL_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") void sendShopPresenceHeartbeat(shopId);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [authMode, isOnline, paused, shopId]);
}
