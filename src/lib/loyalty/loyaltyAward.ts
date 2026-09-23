/**
 * Post-sale loyalty award read-back (Phase 3).
 *
 * The award is written server-side by the loyalty trigger when the completed
 * sale reaches the database — never by this client. So the only honest thing a
 * POS can show right after checkout is:
 *
 *   - an ESTIMATE, until the sale has synced and the ledger row exists;
 *   - the CONFIRMED earned points + new balance, once it does.
 *
 * Everything here is read-only and failure-isolated: an unreachable server
 * leaves the result "pending", never an error, and never blocks the sale.
 */

import { hasSupabaseConfig, supabase } from "../supabase";

export type ConfirmedAward = {
  earnedPoints: number;
  /** Balance the ledger recorded immediately after this award. */
  balancePoints: number;
};

/**
 * The confirmed `earned` ledger row for one sale, or null when the server has
 * not awarded it yet (sale still queued, program disabled, no member attached).
 * Reads through loyalty_transactions' own RLS — a shop only ever sees its own.
 */
export async function fetchConfirmedAwardForSale(
  shopId: string,
  saleId: string,
): Promise<ConfirmedAward | null> {
  if (!hasSupabaseConfig || !supabase || !shopId || !saleId) return null;
  try {
    const { data, error } = await supabase
      .from("loyalty_transactions")
      .select("points, balance_after")
      .eq("shop_id", shopId)
      .eq("source_sale_id", saleId)
      .eq("kind", "earned")
      .maybeSingle();
    if (error || !data) return null;
    const points = Number((data as { points: number }).points);
    if (!Number.isFinite(points) || points <= 0) return null;
    return {
      earnedPoints: points,
      balancePoints: Number((data as { balance_after: number }).balance_after ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Poll for the award while the sale syncs. Resolves as soon as the ledger row
 * appears; gives up quietly so the caller can keep showing the estimate rather
 * than claim something the server has not actually recorded.
 */
export async function awaitConfirmedAward(
  shopId: string,
  saleId: string,
  opts: { attempts?: number; intervalMs?: number; signal?: { cancelled: boolean } } = {},
): Promise<ConfirmedAward | null> {
  const attempts = opts.attempts ?? 8;
  const intervalMs = opts.intervalMs ?? 1500;
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.cancelled) return null;
    const found = await fetchConfirmedAwardForSale(shopId, saleId);
    if (found) return found;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return null;
}
