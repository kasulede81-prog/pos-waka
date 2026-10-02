import { QueryClient } from "@tanstack/react-query";

/**
 * Shared React Query client — cleared on enterprise logout.
 *
 * Defaults tuned for low-end Android on weak/slow Ugandan mobile networks. This
 * only affects React Query-backed reads; DKASU's Zustand/offline-first financial
 * data flow (sales, inventory, sync queue) is untouched.
 * - staleTime 45s: don't refetch the same query on every mount within the window.
 * - refetchOnWindowFocus off: focus changes (keyboard, app switch) must not fire
 *   a burst of refetches on a 3G connection.
 * - refetchOnReconnect on: coming back online SHOULD refresh (matches offline-first).
 * - retry 2 with capped exponential backoff: keep resilience, avoid hammering a
 *   high-latency/lossy link; mutations don't auto-retry (callers own that).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 45_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 15_000),
    },
    mutations: {
      retry: 0,
    },
  },
});
