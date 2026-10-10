import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseEmailVerified } from "../lib/emailVerification";
import { fetchSubscriptionSnapshotForUser } from "../lib/fetchShopSubscription";
import { onActiveShopIdChange } from "../offline/shopScope";
import type { SubscriptionSnapshot } from "../lib/subscriptionEntitlements";
import { setStoreSubscriptionContext } from "../lib/storeSubscriptionContext";
import { createRefreshFailureReporter } from "../lib/liveRefreshDiagnostics";
import { useForegroundRefresh } from "../hooks/useForegroundRefresh";

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
  const failuresRef = useRef(createRefreshFailureReporter("subscription"));

  /**
   * WHOSE ANSWER IS THIS? Shop switches issue overlapping reads — A then B, or A→B→A in quick
   * succession — and a slower earlier request must never land on top of a newer one. Only the
   * newest request may write the snapshot.
   *
   * THE TICKET IS TAKEN BY EVERY PATH, WHICH IT WAS NOT BEFORE. The guard used to sit on the
   * shop-change reload alone, while the mount and same-tab-event paths went through an unguarded
   * `load`. Whenever both were in flight at once — a boot that resolved the active shop while the
   * first read was still out, or a same-tab admin event during a foreground refresh — the older
   * `load` could settle last and reinstate the answer the newer read had just replaced. One
   * sequence, taken first and checked before every write, is what makes "newest wins" true rather
   * than likely.
   */
  const requestSeqRef = useRef(0);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }): Promise<void> => {
      // Taken before anything else, including the branches that answer without a
      // request: signing out or losing verification must retire a read that is
      // still in flight rather than let it land on the new state.
      const seq = ++requestSeqRef.current;

      if (authMode === "local") {
        setSnapshot({ kind: "local_full" });
        setLoading(false);
        loadedOnceRef.current = true;
        failuresRef.current.clear();
        return;
      }
      // Signed out: there is no plan to have, and nothing to downgrade. A real, known answer.
      if (!user?.id) {
        setSnapshot({ kind: "none" });
        setLoading(false);
        failuresRef.current.clear();
        return;
      }
      if (!isSupabaseEmailVerified(user)) {
        // Every path now answers an unverified account the same way. The old split
        // did not: the mount path refused to look, while the shop-change and
        // visibility paths read anyway — so the same user could get `unavailable`
        // at boot and a real plan a moment later, depending only on which path
        // ran. Fail closed everywhere.
        setSnapshot({ kind: "unavailable" });
        setLoading(false);
        loadedOnceRef.current = true;
        return;
      }

      if (!opts?.silent && !loadedOnceRef.current) setLoading(true);
      try {
        const next = await fetchSubscriptionSnapshotForUser(user.id);
        if (seq !== requestSeqRef.current) return; // superseded — drop it
        setSnapshot(next);
        loadedOnceRef.current = true;
        if (next.kind === "unavailable") {
          // A refusal, a 42501 and a dropped connection all arrive here as the same
          // value. Unlike the throwing path below they were previously recorded
          // nowhere at all, so a shop could sit permanently unavailable and look
          // exactly like a shop whose plan was simply unchanged.
          failuresRef.current.report("subscription_read_unavailable");
        } else {
          failuresRef.current.clear();
        }
      } catch (error) {
        if (seq !== requestSeqRef.current) return;
        // A THROWN READ IS NOT A FREE PLAN. This used to write `none`, which is why a transient
        // failure could present a paying shop as Free. `unavailable` never downgrades.
        setSnapshot({ kind: "unavailable" });
        failuresRef.current.report(error);
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    },
    [authMode, user?.id],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setStoreSubscriptionContext({ snapshot, authMode });
  }, [snapshot, authMode]);

  useEffect(() => {
    const on = () => {
      void refresh({ silent: true });
    };
    window.addEventListener("waka:subscription-updated", on);
    return () => window.removeEventListener("waka:subscription-updated", on);
  }, [refresh]);

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
      void refresh({ silent: true });
    });
  }, [refresh]);

  /**
   * AN ADMIN CHANGES THE PLAN FROM ANOTHER DEVICE, AND NOTHING PUSHES IT HERE.
   *
   * There is no realtime channel for `subscriptions`, and `waka:subscription-updated` is a
   * same-tab event — so a terminal that was already running kept showing the old plan (and the old
   * price) until someone reloaded the app. That is the whole of the "admin changed the plan but the
   * shop still sees the old one" report: the database was right the entire time.
   *
   * THE FIRST FIX WAS ONLY HALF OF IT. Re-reading on `visibilitychange` covers a tab that is
   * switched away from and back — but a POS terminal sits in the foreground, on one screen, for a
   * whole shift, and never fires that event at all. It also never reached the Android app, whose
   * bundle is baked into the APK and does not follow a web deploy.
   *
   * So the signal is now the shared one (`useForegroundRefresh`): native resume, browser
   * visibility, AND a bounded tick while visible, which is the only one of the three that reaches
   * a terminal nobody ever backgrounds. `refresh` is sequence-guarded, so a resume that lands
   * during an in-flight read cannot be overwritten by it.
   */
  useForegroundRefresh(() => refresh({ silent: true }), {
    // Nothing remote to keep current when signed out, or in the offline-only mode.
    enabled: authMode === "supabase" && Boolean(user?.id),
  });

  const value = useMemo(
    () => ({
      authMode,
      snapshot,
      loading,
      userId: user?.id ?? null,
      refetch: refresh,
    }),
    [authMode, snapshot, loading, refresh, user?.id],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionContextValue {
  return useContext(SubscriptionContext);
}
