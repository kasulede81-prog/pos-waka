import { useEffect } from "react";
import { useSubscription } from "../context/SubscriptionContext";
import { useOfflineStatus } from "./useOfflineStatus";
import { sendShopPresenceHeartbeat } from "../lib/shopPresence";

const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

/** Keeps shop + device last_seen fresh while the POS app is open and online. */
export function useShopPresenceHeartbeat(): void {
  const { authMode, snapshot } = useSubscription();
  const { isOnline } = useOfflineStatus();

  const shopId = snapshot.kind === "remote" ? snapshot.row.shop_id : null;

  useEffect(() => {
    if (authMode !== "supabase" || !shopId || !isOnline) return;

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
  }, [authMode, shopId, isOnline]);
}
