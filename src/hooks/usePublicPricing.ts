import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildDefaultPublicPricing,
  type PublicPricingSnapshot,
} from "../lib/subscriptionPricing";
import { fetchPublicSubscriptionPricingResult } from "../lib/pricingCampaignsAdmin";
import { createRefreshFailureReporter } from "../lib/liveRefreshDiagnostics";
import { useForegroundRefresh } from "./useForegroundRefresh";

/**
 * The canonical plan price book plus the active campaign discount, kept current.
 *
 * WHY IT RE-READS. An admin can change a plan's price or a campaign discount at
 * any moment, and an open shop app used to hold the price it read at mount
 * forever — so the upgrade page and the checkout quoted yesterday's number until
 * someone reloaded. It now follows the shared foreground/periodic signal
 * (`useForegroundRefresh`), which is the same mechanism the subscription
 * snapshot uses. There is exactly one of these, deliberately: a second private
 * interval here would drift from it, and on Android resume would double every
 * read.
 *
 * A FAILED REFRESH KEEPS THE LAST GOOD PRICE BOOK. This is the reason the hook
 * does not call `fetchPublicSubscriptionPricing`: that function answers every
 * failure with the hardcoded default catalogue, so a poll ticking over one blip
 * would silently repaint real prices as defaults. Stale is bad; fabricated is
 * worse. The failure is recorded instead (see `liveRefreshDiagnostics`) and
 * surfaced as `refreshError`.
 *
 * A SUPERSEDED READ NEVER LANDS. Overlapping refreshes are already prevented
 * upstream, but a shop switch or a slow response can still resolve out of order,
 * so every write is gated on still being the newest request.
 */
export function usePublicPricing(options?: {
  intervalMs?: number;
  enabled?: boolean;
}): {
  pricing: PublicPricingSnapshot;
  loading: boolean;
  /** Set when the most recent refresh failed; the last good pricing is retained. */
  refreshError: string | null;
  reload: (opts?: { silent?: boolean }) => Promise<void>;
} {
  const [pricing, setPricing] = useState<PublicPricingSnapshot>(buildDefaultPublicPricing);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const seqRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const mountedRef = useRef(true);
  const failuresRef = useRef(createRefreshFailureReporter("public_pricing"));

  const reload = useCallback(async (opts?: { silent?: boolean }): Promise<void> => {
    const seq = ++seqRef.current;
    // A silent refresh must not flash a loader over prices that are already on
    // screen; the first load still shows one.
    if (!opts?.silent && !hasLoadedRef.current) setLoading(true);

    const result = await fetchPublicSubscriptionPricingResult();
    if (!mountedRef.current || seq !== seqRef.current) return; // superseded

    if (result.ok) {
      setPricing(result.snapshot);
      hasLoadedRef.current = true;
      setRefreshError(null);
      failuresRef.current.clear();
    } else {
      // Keep the last valid price book. Never fall back to the default catalogue.
      setRefreshError(result.error);
      failuresRef.current.report(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    return () => {
      mountedRef.current = false;
    };
  }, [reload]);

  useForegroundRefresh(() => reload({ silent: true }), {
    intervalMs: options?.intervalMs,
    enabled: options?.enabled,
  });

  return { pricing, loading, refreshError, reload };
}
