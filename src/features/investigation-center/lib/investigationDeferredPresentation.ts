/**
 * IC-NEW-04 — presentation readiness while useDeferredValue is behind.
 * IC-P2-04 hydration and IC-P2-07 sales-tail helpers stay authoritative on their own axes.
 * Identity is safe: reporting hooks memoize, and useDeferredValue returns that same
 * reference once the deferred render commits.
 */
export function investigationDeferredValueCaughtUp<T>(authoritative: T, deferred: T): boolean {
  return Object.is(authoritative, deferred);
}

export function resolveInvestigationPresentationDataComplete(input: {
  hydrationComplete: boolean;
  auditLogsCaughtUp: boolean;
}): boolean {
  return input.hydrationComplete && input.auditLogsCaughtUp;
}

export function resolveInvestigationPresentationSalesDependentReady(input: {
  salesHistoryHydrationActive: boolean;
  salesCaughtUp: boolean;
}): boolean {
  return !input.salesHistoryHydrationActive && input.salesCaughtUp;
}
