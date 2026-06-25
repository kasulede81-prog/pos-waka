import { useCallback, useEffect, useState } from "react";
import { useSessionActor } from "../context/SessionActorContext";
import { useSessionHydration } from "../context/SessionHydrationContext";
import { useSubscription } from "../context/SubscriptionContext";
import { fetchMarketingAgentMe, type MarketingAgentMe } from "../lib/referralAgents";
import { supabase } from "../lib/supabase";

/** Resolves marketing-agent identity once Supabase session + shop role are ready. */
export function useMarketingAgentPortal() {
  const actor = useSessionActor();
  const { authMode, loading: subscriptionLoading } = useSubscription();
  const { roleReady } = useSessionHydration();
  const [agent, setAgent] = useState<MarketingAgentMe | null>(null);
  const [loading, setLoading] = useState(true);

  const sessionReady =
    authMode === "local" || (authMode === "supabase" && !subscriptionLoading && roleReady && actor.userId !== "unknown");

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!sessionReady) return;
    if (!opts?.silent) setLoading(true);
    if (!supabase) {
      setAgent(null);
      setLoading(false);
      return;
    }
    const me = await fetchMarketingAgentMe();
    setAgent(me);
    setLoading(false);
  }, [sessionReady]);

  useEffect(() => {
    if (!sessionReady) {
      setLoading(true);
      return;
    }
    void refresh();
  }, [sessionReady, actor.userId, refresh]);

  useEffect(() => {
    const onFocus = () => void refresh({ silent: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return {
    agent,
    isMarketingAgent: Boolean(agent),
    loading: !sessionReady || loading,
    refresh,
  };
}
