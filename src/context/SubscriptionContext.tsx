import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { fetchRemoteSubscriptionForUser } from "../lib/fetchShopSubscription";
import type { SubscriptionSnapshot } from "../lib/subscriptionEntitlements";
import { trialDaysRemaining } from "../lib/subscriptionEntitlements";

export type SubscriptionContextValue = {
  authMode: "supabase" | "local";
  snapshot: SubscriptionSnapshot;
  loading: boolean;
  refetch: () => Promise<void>;
  daysLeftInTrial: number | null;
};

const defaultValue: SubscriptionContextValue = {
  authMode: "local",
  snapshot: { kind: "local_full" },
  loading: false,
  refetch: async () => {},
  daysLeftInTrial: null,
};

const SubscriptionContext = createContext<SubscriptionContextValue>(defaultValue);

export function SubscriptionProvider({
  user,
  authMode,
  children,
}: {
  user: User | null;
  authMode: "supabase" | "local";
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot>(
    authMode === "local" ? { kind: "local_full" } : { kind: "none" },
  );
  /** True until the first remote subscription fetch settles (avoids tier gates on stale { kind: "none" }). */
  const [loading, setLoading] = useState(() => authMode === "supabase" && Boolean(user?.id));

  const load = useCallback(async () => {
    if (authMode === "local") {
      setSnapshot({ kind: "local_full" });
      setLoading(false);
      return;
    }
    if (!user?.id) {
      setSnapshot({ kind: "none" });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const row = await fetchRemoteSubscriptionForUser(user.id);
      setSnapshot(row ? { kind: "remote", row } : { kind: "none" });
    } catch {
      setSnapshot({ kind: "none" });
    } finally {
      setLoading(false);
    }
  }, [authMode, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const on = () => {
      void load();
    };
    window.addEventListener("waka:subscription-updated", on);
    return () => window.removeEventListener("waka:subscription-updated", on);
  }, [load]);

  const daysLeftInTrial = useMemo(() => trialDaysRemaining(snapshot), [snapshot]);

  const value = useMemo(
    () => ({
      authMode,
      snapshot,
      loading,
      refetch: load,
      daysLeftInTrial,
    }),
    [authMode, snapshot, loading, load, daysLeftInTrial],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionContextValue {
  return useContext(SubscriptionContext);
}
