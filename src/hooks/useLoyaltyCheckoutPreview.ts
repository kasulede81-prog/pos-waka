import { useEffect, useMemo, useState } from "react";
import { resolveShopCtx } from "../offline/cloudSync";
import { fetchLoyaltyAccount, fetchLoyaltyProgramConfig } from "../lib/loyalty/loyaltyClient";
import { computeEarnedPoints, type LoyaltyAccountSnapshot, type LoyaltyProgramConfig } from "../lib/loyalty/loyaltyMath";

export type LoyaltyCheckoutPreview = {
  /** Null when the program is missing/disabled or loyalty is unreachable. */
  program: LoyaltyProgramConfig | null;
  account: LoyaltyAccountSnapshot | null;
  /** Points this sale is expected to earn (preview only — award is server-side). */
  expectedPoints: number;
  /** True when the program config came from the offline cache. */
  fromCache: boolean;
  loading: boolean;
};

/**
 * Checkout loyalty preview (Phase 03).
 *
 * Fully failure-isolated: any cloud error resolves to an empty preview, so
 * loyalty can never break checkout. The hook only READS; awarding happens in
 * the database when the completed sale syncs.
 */
export function useLoyaltyCheckoutPreview(customerId: string, totalUgx: number): LoyaltyCheckoutPreview {
  const [shopId, setShopId] = useState<string | null>(null);
  const [program, setProgram] = useState<LoyaltyProgramConfig | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [account, setAccount] = useState<LoyaltyAccountSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const ctx = await resolveShopCtx();
      if (cancelled) return;
      setShopId(ctx?.shopId ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    void (async () => {
      const { config, fromCache: cached } = await fetchLoyaltyProgramConfig(shopId);
      if (cancelled) return;
      setProgram(config);
      setFromCache(cached);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  useEffect(() => {
    if (!shopId || !customerId) {
      setAccount(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const snapshot = await fetchLoyaltyAccount(shopId, customerId);
      if (cancelled) return;
      setAccount(snapshot);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId, customerId]);

  const expectedPoints = useMemo(
    () => (program && customerId ? computeEarnedPoints(totalUgx, program) : 0),
    [program, customerId, totalUgx],
  );

  return { program, account, expectedPoints, fromCache, loading };
}
