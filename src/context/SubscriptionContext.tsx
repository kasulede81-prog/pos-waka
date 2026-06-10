import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseEmailVerified } from "../lib/emailVerification";
import { fetchSubscriptionSnapshotForUser } from "../lib/fetchShopSubscription";
import type { SubscriptionSnapshot } from "../lib/subscriptionEntitlements";

export type SubscriptionContextValue = {
  authMode: "supabase" | "local";
  snapshot: SubscriptionSnapshot;
  loading: boolean;
  userId: string | null;
  refetch: () => Promise<void>;
};

const defaultValue: SubscriptionContextValue = {
  authMode: "local",
  snapshot: { kind: "local_full" },
  loading: false,
  userId: null,
  refetch: async () => {},
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
  const loadedOnceRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (authMode === "local") {
      setSnapshot({ kind: "local_full" });
      setLoading(false);
      loadedOnceRef.current = true;
      return;
    }
    if (!user?.id) {
      setSnapshot({ kind: "none" });
      setLoading(false);
      return;
    }
    if (!isSupabaseEmailVerified(user)) {
      setSnapshot({ kind: "none" });
      setLoading(false);
      loadedOnceRef.current = true;
      return;
    }
    if (!opts?.silent && !loadedOnceRef.current) setLoading(true);
    try {
      const next = await fetchSubscriptionSnapshotForUser(user.id);
      setSnapshot(next);
      loadedOnceRef.current = true;
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
      void load({ silent: true });
    };
    window.addEventListener("waka:subscription-updated", on);
    return () => window.removeEventListener("waka:subscription-updated", on);
  }, [load]);

  const value = useMemo(
    () => ({
      authMode,
      snapshot,
      loading,
      userId: user?.id ?? null,
      refetch: load,
    }),
    [authMode, snapshot, loading, load, user?.id],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionContextValue {
  return useContext(SubscriptionContext);
}
