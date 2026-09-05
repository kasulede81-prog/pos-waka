/**
 * Sales History list chrome — presentation only.
 * Does not load sales, change hydration, or alter listSales matching.
 */

/** True only when deferred sales are still empty and a newer array is pending. */
export function salesHistoryShowsInitialSkeleton(
  salesRefreshing: boolean,
  deferredSalesCount: number,
): boolean {
  return salesRefreshing && deferredSalesCount === 0;
}
