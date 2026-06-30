import { isNativeApp } from "./nativeApp";

type SyncProfile = "native" | "mobile_web" | "desktop";

function syncProfile(): SyncProfile {
  if (isNativeApp()) return "native";
  if (typeof window === "undefined") return "desktop";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 900;
  if (coarse && narrow) return "mobile_web";
  return "desktop";
}

const TIMING: Record<
  SyncProfile,
  {
    postSaleDebounceMs: number;
    minPosPushGapMs: number;
    posPushIntervalMs: number;
    queuePollMs: number;
    autoDrainMs: number;
    minPushIntervalMs: number;
    minFullIntervalMs: number;
    reconnectDelayMs: number;
    pullMinIntervalMs: number;
    salePushConcurrency: number;
    queueFlushConcurrency: number;
    visibilityDelayMs: number;
    appResumeDelayMs: number;
    startupIdleMs: number;
  }
> = {
  native: {
    postSaleDebounceMs: 500,
    minPosPushGapMs: 4_000,
    posPushIntervalMs: 12_000,
    queuePollMs: 30_000,
    autoDrainMs: 25_000,
    minPushIntervalMs: 6_000,
    minFullIntervalMs: 90_000,
    reconnectDelayMs: 200,
    pullMinIntervalMs: 2 * 60_000,
    salePushConcurrency: 3,
    queueFlushConcurrency: 2,
    visibilityDelayMs: 1_200,
    appResumeDelayMs: 1_500,
    startupIdleMs: 600,
  },
  mobile_web: {
    postSaleDebounceMs: 350,
    minPosPushGapMs: 2_500,
    posPushIntervalMs: 12_000,
    queuePollMs: 18_000,
    autoDrainMs: 18_000,
    minPushIntervalMs: 4_000,
    minFullIntervalMs: 60_000,
    reconnectDelayMs: 150,
    pullMinIntervalMs: 90_000,
    salePushConcurrency: 4,
    queueFlushConcurrency: 3,
    visibilityDelayMs: 500,
    appResumeDelayMs: 500,
    startupIdleMs: 400,
  },
  desktop: {
    postSaleDebounceMs: 120,
    minPosPushGapMs: 600,
    posPushIntervalMs: 4_000,
    queuePollMs: 6_000,
    autoDrainMs: 5_000,
    minPushIntervalMs: 900,
    minFullIntervalMs: 18_000,
    reconnectDelayMs: 40,
    pullMinIntervalMs: 45_000,
    salePushConcurrency: 6,
    queueFlushConcurrency: 5,
    visibilityDelayMs: 80,
    appResumeDelayMs: 80,
    startupIdleMs: 120,
  },
};

function profile() {
  return TIMING[syncProfile()];
}

/** Debounce after checkout before first push attempt. */
export const POST_SALE_PUSH_DEBOUNCE_MS = profile().postSaleDebounceMs;

/** Minimum gap between POS push-only uploads (non-forced). */
export const MIN_POS_PUSH_GAP_MS = profile().minPosPushGapMs;

/** Background push interval while on POS routes (pull paused). */
export const POS_PUSH_INTERVAL_MS = profile().posPushIntervalMs;

/** Poll local queue for pending badge updates. */
export const SYNC_QUEUE_POLL_MS = profile().queuePollMs;

/** Background drain interval when pull+push is allowed. */
export const SYNC_AUTO_DRAIN_MS = profile().autoDrainMs;

/** Minimum gap between push-only flushes in SyncStatusProvider. */
export const SYNC_MIN_PUSH_INTERVAL_MS = profile().minPushIntervalMs;

/** Minimum gap between full pull+push cycles. */
export const SYNC_MIN_FULL_INTERVAL_MS = profile().minFullIntervalMs;

/** Delay after reconnect before sync resumes. */
export const SYNC_RECONNECT_DELAY_MS = profile().reconnectDelayMs;

/** Minimum time between automatic cloud pulls. */
export const SYNC_PULL_MIN_INTERVAL_MS = profile().pullMinIntervalMs;

/** Parallel sale uploads per push batch. */
export const SYNC_SALE_PUSH_CONCURRENCY = profile().salePushConcurrency;

/** Parallel offline-queue operations (independent ops). */
export const SYNC_QUEUE_FLUSH_CONCURRENCY = profile().queueFlushConcurrency;

/** Delay before sync after app returns to foreground. */
export function syncVisibilityDelayMs(): number {
  return profile().visibilityDelayMs;
}

/** Delay before sync after native app resume. */
export function syncAppResumeDelayMs(): number {
  return profile().appResumeDelayMs;
}

/** Startup idle delay before first background sync. */
export function syncStartupIdleMs(): number {
  return profile().startupIdleMs;
}

/** For diagnostics — which sync cadence profile is active. */
export function activeSyncProfile(): SyncProfile {
  return syncProfile();
}
