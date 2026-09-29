import { useCallback, useEffect, useRef, useState } from "react";
import {
  ENROLLMENT_FALLBACK_POLL_MS,
  fetchMemberEnrollmentStatus,
  resolveEnrollmentState,
  subscribeToMemberEnrollmentChanges,
  type MemberEnrollmentState,
} from "../lib/loyalty/loyaltyMemberEnrollment";

/**
 * Phase 2D — keeps a member's enrollment status current without a manual refresh.
 *
 * AUTHORITY: every path here ends in the same server read. Realtime only decides WHEN to read.
 * Nothing in this hook can grant membership, and it never inspects an event payload.
 *
 * RACE CONDITIONS, and how each is closed:
 *
 *   approved before the subscription opened
 *     → the initial `refresh()` on mount reads the server, so the page is correct on first paint
 *       regardless of what has already happened.
 *
 *   approved between the initial read and the subscription opening
 *     → `subscribeToMemberEnrollmentChanges` signals on every transition into SUBSCRIBED, and this
 *       hook refetches on that signal. The gap between "we read" and "we are listening" is
 *       therefore re-read once listening actually begins.
 *
 *   browser reconnect / socket drop
 *     → resubscribing produces another SUBSCRIBED signal, which refetches. `online` and the app's
 *       own `waka:network-online` event refetch too.
 *
 *   tab sleeping and waking
 *     → `visibilitychange` refetches when the tab becomes visible. A backgrounded tab may have its
 *       socket throttled and can miss events entirely.
 *
 *   realtime never arriving at all
 *     → a slow fallback tick (30s) keeps the status honest. Realtime is primary; this exists so a
 *       blocked socket degrades to "slightly stale" rather than "permanently wrong".
 *
 *   sign-out while subscribed
 *     → the page unmounts, the effect cleanup unsubscribes, and the fallback tick is cleared. No
 *       channel outlives the session that opened it.
 *
 * A FAILED READ KEEPS THE LAST KNOWN STATE. It never falls back to "no requests", because showing
 * "nothing pending" to someone whose approval just landed — or whose network merely blipped — is
 * worse than showing the previous status for one more tick.
 */
export function useMemberEnrollmentStatus(enabled: boolean): {
  state: MemberEnrollmentState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<MemberEnrollmentState>({ kind: "none" });
  const mountedRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await fetchMemberEnrollmentStatus();
    if (!mountedRef.current) return;
    if (result.ok) setState(resolveEnrollmentState(result.requests));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      setState({ kind: "none" });
      return () => {
        mountedRef.current = false;
      };
    }

    let cancelled = false;
    const signal = (reason: string) => {
      if (cancelled) return;
      // `reason` is deliberately unused beyond this point: it is a nudge, not information.
      void reason;
      void refresh();
    };

    void refresh();
    const unsubscribe = subscribeToMemberEnrollmentChanges(signal);

    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") signal("visible");
    };
    const onOnline = () => signal("online");

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("waka:network-online", onOnline);

    const tick = window.setInterval(() => signal("fallback_poll"), ENROLLMENT_FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("waka:network-online", onOnline);
      window.clearInterval(tick);
    };
  }, [enabled, refresh]);

  return { state, refresh };
}
