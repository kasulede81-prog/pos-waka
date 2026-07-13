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
    eventPullBypassMs: number;
    salePushConcurrency: number;
    queueFlushConcurrency: number;
    visibilityDelayMs: number;
    appResumeDelayMs: number;
    startupIdleMs: number;
    immediateCoalesceMs: number;
  }
> = {
  native: {
    postSaleDebounceMs: 80,
    minPosPushGapMs: 800,
    posPushIntervalMs: 8_000,
    queuePollMs: 12_000,
    autoDrainMs: 20_000,
    minPushIntervalMs: 1_200,
    minFullIntervalMs: 45_000,
    reconnectDelayMs: 100,
    pullMinIntervalMs: 15_000,
    eventPullBypassMs: 2_000,
    salePushConcurrency: 4,
    queueFlushConcurrency: 3,
    visibilityDelayMs: 200,
    appResumeDelayMs: 250,
    startupIdleMs: 300,
    immediateCoalesceMs: 280,
  },
  mobile_web: {
    postSaleDebounceMs: 60,
    minPosPushGapMs: 500,
    posPushIntervalMs: 6_000,
    queuePollMs: 10_000,
    autoDrainMs: 15_000,
    minPushIntervalMs: 900,
    minFullIntervalMs: 35_000,
    reconnectDelayMs: 80,
    pullMinIntervalMs: 12_000,
    eventPullBypassMs: 1_500,
    salePushConcurrency: 5,
    queueFlushConcurrency: 4,
    visibilityDelayMs: 120,
    appResumeDelayMs: 180,
    startupIdleMs: 200,
    immediateCoalesceMs: 250,
  },
  desktop: {
    postSaleDebounceMs: 40,
    minPosPushGapMs: 300,
    posPushIntervalMs: 3_000,
    queuePollMs: 5_000,
    autoDrainMs: 8_000,
    minPushIntervalMs: 400,
    minFullIntervalMs: 12_000,
    reconnectDelayMs: 40,
    pullMinIntervalMs: 8_000,
    eventPullBypassMs: 1_000,
    salePushConcurrency: 6,
    queueFlushConcurrency: 5,
    visibilityDelayMs: 60,
    appResumeDelayMs: 60,
    startupIdleMs: 80,
    immediateCoalesceMs: 200,
  },
};

function profile() {
  return TIMING[syncProfile()];
}

/** Legacy debounce — immediate path bypasses via force upload. */
export const POST_SALE_PUSH_DEBOUNCE_MS = profile().postSaleDebounceMs;

/** Minimum gap between routine POS pushes (immediate force bypasses). */
export const MIN_POS_PUSH_GAP_MS = profile().minPosPushGapMs;

/** Safety polling interval for pending uploads. */
export const POS_PUSH_INTERVAL_MS = profile().posPushIntervalMs;

/** Poll local queue for pending badge updates. */
export const SYNC_QUEUE_POLL_MS = profile().queuePollMs;

/** Safety polling for background drain. */
export const SYNC_AUTO_DRAIN_MS = profile().autoDrainMs;

/** Minimum gap between routine push-only flushes in SyncStatusProvider. */
export const SYNC_MIN_PUSH_INTERVAL_MS = profile().minPushIntervalMs;

/** Minimum gap between full pull+push cycles. */
export const SYNC_MIN_FULL_INTERVAL_MS = profile().minFullIntervalMs;

/** Delay after reconnect before sync resumes. */
export const SYNC_RECONNECT_DELAY_MS = profile().reconnectDelayMs;

/** Minimum time between timer-driven cloud pulls. */
export const SYNC_PULL_MIN_INTERVAL_MS = profile().pullMinIntervalMs;

/** Event-driven pulls bypass min interval if last event pull was longer ago. */
export const SYNC_EVENT_PULL_MIN_MS = profile().eventPullBypassMs;

/** Coalesce rapid catalog edits into one upload. */
export const IMMEDIATE_PUSH_COALESCE_MS = profile().immediateCoalesceMs;

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
