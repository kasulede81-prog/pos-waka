import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseEmailVerified } from "../lib/emailVerification";
import { fetchSubscriptionSnapshotForUser } from "../lib/fetchShopSubscription";
import type { SubscriptionSnapshot } from "../lib/subscriptionEntitlements";
import { setStoreSubscriptionContext } from "../lib/storeSubscriptionContext";

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
    setStoreSubscriptionContext({ snapshot, authMode });
  }, [snapshot, authMode]);

  /**
   * Whose answer is this? Shop switches issue overlapping reads — A then B, or A→B→A in quick
   * succession — and a slower earlier request must never land on top of a newer one. Only the
   * newest request may write the snapshot.
   */
  const requestSeqRef = useRef(0);

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      const seq = ++requestSeqRef.current;
      const next = await (async () => {
        if (!user?.id) return null;
        try {
          return await fetchSubscriptionSnapshotForUser(user.id);
        } catch {
          return { kind: "unavailable" } as const;
        }
      })();
      if (seq !== requestSeqRef.current) return; // superseded — drop it
      if (next) setSnapshot(next);
      else void load(opts);
    },
    [load, user?.id],
  );

  useEffect(() => {
    const on = () => {
      void load({ silent: true });
    };
    window.addEventListener("waka:subscription-updated", on);
    return () => window.removeEventListener("waka:subscription-updated", on);
  }, [load]);

  /**
   * A SHOP SWITCH CHANGES THE ANSWER. The plan belongs to the shop being operated, so switching
   * shop must re-resolve — without this, a cashier who moved between two shops kept the first
   * shop's plan for the rest of the session. `switchActiveShop` dispatches this after it has
   * attached the new partition, so the re-read sees the new active shop.
   */
  useEffect(() => {
    const onShopChanged = () => {
      void reload({ silent: true });
    };
    window.addEventListener("waka:active-shop-changed", onShopChanged);
    return () => window.removeEventListener("waka:active-shop-changed", onShopChanged);
  }, [reload]);

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
