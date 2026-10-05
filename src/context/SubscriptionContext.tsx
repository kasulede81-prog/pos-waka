import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseEmailVerified } from "../lib/emailVerification";
import { fetchSubscriptionSnapshotForUser } from "../lib/fetchShopSubscription";
import { onActiveShopIdChange } from "../offline/shopScope";
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
  /**
   * THE PLAN IS NOT KNOWN UNTIL THE SHOP IS. This used to start at `{ kind: "none" }`, which
   * resolves to the free tier — so the very first render of every load asserted Free before
   * anything had been asked. `loading` masked part of it, but any consumer reading the tier
   * outside that window saw Free. `unavailable` is the honest starting state: we have not looked
   * yet, and "we have not looked" must never be spelled "free" (see the note on the type).
   */
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot>(
    authMode === "local" ? { kind: "local_full" } : { kind: "unavailable" },
  );
  /** True until the first remote subscription fetch settles (avoids tier gates on a stale snapshot). */
  const [loading, setLoading] = useState(() => authMode === "supabase" && Boolean(user?.id));
  const loadedOnceRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (authMode === "local") {
      setSnapshot({ kind: "local_full" });
      setLoading(false);
      loadedOnceRef.current = true;
      return;
    }
    // Signed out: there is no plan to have, and nothing to downgrade. A real, known answer.
    if (!user?.id) {
      setSnapshot({ kind: "none" });
      setLoading(false);
      return;
    }
    if (!isSupabaseEmailVerified(user)) {
      setSnapshot({ kind: "unavailable" });
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
      // A THROWN READ IS NOT A FREE PLAN. This used to write `none`, which is why a transient
      // failure could present a paying shop as Free.
      setSnapshot({ kind: "unavailable" });
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
   * THE ACTIVE SHOP *IS* THE SIGNAL — not the DOM event that sometimes accompanies it.
   *
   * This listened for `waka:active-shop-changed`, which `switchActiveShop` dispatches and boot does
   * NOT. Boot activates the shop through `activateKnownShop()` → `setActiveShopId()`, so a page
   * load set the active shop *after* the first resolve and never told this context — and because
   * the earlier read had already happened with no shop, the cashier stayed on the wrong tier for
   * the rest of the session. `onActiveShopIdChange` is the state mechanism itself: it fires on boot
   * activation, on a user switch, and on sign-out (null), which is exactly the set of moments the
   * answer can change.
   */
  useEffect(() => {
    return onActiveShopIdChange((next, prev) => {
      // null → null, or a change we already know about, is not a reason to re-read.
      if (next === prev) return;
      void reload({ silent: true });
    });
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
