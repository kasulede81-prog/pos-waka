/** Stock freshness helpers for oversell protection before sale finalize. */

import { readSyncCheckpoints } from "./syncCheckpoints";
import { readSyncHealthMeta } from "./syncMeta";

const STOCK_FRESH_MS = 5 * 60_000;

export function isLocalStockFresh(): boolean {
  const cp = readSyncCheckpoints();
  if (!cp.bootstrapComplete) return false;
  const meta = readSyncHealthMeta();
  const pullAt = meta.lastPullAt ?? cp.lastProductsSyncAt ?? cp.lastSalesSyncAt;
  if (!pullAt) return false;
  return Date.now() - Date.parse(pullAt) < STOCK_FRESH_MS;
}
