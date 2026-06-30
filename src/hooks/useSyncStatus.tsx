import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { shouldPausePosBackgroundPull } from "../lib/backgroundWorkPolicy";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { deriveQueueHealth } from "../lib/autoSync";
import { getDeviceOnline } from "../lib/deviceOnline";
import { runWhenIdle } from "../lib/uiYield";
import { readSyncQueue } from "../offline/localDb";
import { pushShopPendingToCloud, syncShopWithCloud, countUnsyncedSales } from "../offline/cloudSync";
import { POS_PUSH_INTERVAL_MS, runPosPushOnlyUpload } from "../lib/posPushScheduler";
import {
  SYNC_AUTO_DRAIN_MS,
  SYNC_MIN_FULL_INTERVAL_MS,
  SYNC_MIN_PUSH_INTERVAL_MS,
  SYNC_QUEUE_POLL_MS,
  SYNC_RECONNECT_DELAY_MS,
  syncAppResumeDelayMs,
  syncStartupIdleMs,
  syncVisibilityDelayMs,
} from "../lib/syncTiming";
import { useOfflineStatus } from "./useOfflineStatus";
import { readSyncHealthMeta, writeSyncHealthMeta, type SyncHealthMeta } from "../lib/syncMeta";
import { appendPilotEvent } from "../lib/pilotEventLog";
import { pilotSyncLog } from "../lib/pilotSyncLog";
import { captureAppException } from "../lib/crashReporting";
import type { SyncOperationKind, SyncStatus } from "../types";

type PendingBreakdown = {
  sales: number;
  stock: number;
  returns: number;
  expenses: number;
  other: number;
};

export type SyncStatusApi = {
  isOnline: boolean;
  pendingCount: number;
  pendingBreakdown: PendingBreakdown;
  syncing: boolean;
  /** True when cloud pull is deferred on POS routes (push-only uploads still run). */
  pullPaused: boolean;
  status: SyncStatus;
  health: SyncHealthMeta;
  refreshQueue: () => void;
  /** Diagnostics-only manual sync (pull + push). */
  flush: () => Promise<void>;
  flushFull: () => Promise<void>;
};

const SyncStatusContext = createContext<SyncStatusApi | null>(null);

const QUEUE_POLL_MS = SYNC_QUEUE_POLL_MS;
const AUTO_DRAIN_MS = SYNC_AUTO_DRAIN_MS;
const FLUSH_TIMEOUT_MS = 55_000;
const MIN_PUSH_INTERVAL_MS = SYNC_MIN_PUSH_INTERVAL_MS;
const MIN_FULL_SYNC_INTERVAL_MS = SYNC_MIN_FULL_INTERVAL_MS;
const RECONNECT_FLUSH_DELAY_MS = SYNC_RECONNECT_DELAY_MS;

function emptyBreakdown(): PendingBreakdown {
  return { sales: 0, stock: 0, returns: 0, expenses: 0, other: 0 };
}

function bucketForKind(kind: SyncOperationKind): keyof PendingBreakdown {
  if (kind === "pending_sales" || kind === "sale") return "sales";
  if (
    kind === "pending_stock_updates" ||
    kind === "pending_purchases" ||
    kind === "stock_move" ||
    kind === "product" ||
    kind === "purchase" ||
    kind === "supplier"
  )
    return "stock";
  if (kind === "pending_returns") return "returns";
  if (kind === "pending_expenses" || kind === "pending_cash_expenses" || kind === "pending_cash_drawer_adjustments") {
    return "expenses";
  }
  return "other";
}

function hasPendingSyncWork(pendingQueue: number): boolean {
  return pendingQueue > 0 || countUnsyncedSales() > 0;
}

async function pendingUploadStats(): Promise<{ total: number; breakdown: PendingBreakdown; queueHealth: SyncHealthMeta["queueHealth"] }> {
  const queue = await readSyncQueue();
  const breakdown = emptyBreakdown();
  for (const op of queue) {
    const bucket = bucketForKind(op.kind);
    breakdown[bucket] += 1;
  }
  const total = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  return { total, breakdown, queueHealth: deriveQueueHealth(queue) };
}

function useSyncStatusEngine(opts?: { pullPaused?: boolean }) {
  const pullPaused = opts?.pullPaused === true;
  const { isOnline } = useOfflineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingBreakdown, setPendingBreakdown] = useState<PendingBreakdown>(() => emptyBreakdown());
  const [syncing, setSyncing] = useState(false);
  const [health, setHealth] = useState<SyncHealthMeta>(() => readSyncHealthMeta());
  const syncingRef = useRef(false);
  const lastPushAtRef = useRef(0);
  const lastFullSyncAtRef = useRef(0);
  const visTimerRef = useRef<number | null>(null);
  const pendingRef = useRef(0);
  const wasOnlineRef = useRef(isOnline);
  const startupDoneRef = useRef(false);

  const refreshQueue = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void pendingUploadStats().then(({ total, breakdown, queueHealth }) => {
      pendingRef.current = total;
      setPendingCount(total);
      setPendingBreakdown(breakdown);
      writeSyncHealthMeta({ queueHealth });
      setHealth(readSyncHealthMeta());
    });
  }, []);

  const runPosPushFlush = useCallback(async (opts?: { showSpinner?: boolean; force?: boolean }) => {
    if (!getDeviceOnline() || syncingRef.current) return;
    syncingRef.current = true;
    if (opts?.showSpinner) setSyncing(true);
    try {
      await runPosPushOnlyUpload({ force: opts?.force, source: "sync_status" });
      lastPushAtRef.current = Date.now();
    } finally {
      syncingRef.current = false;
      if (opts?.showSpinner) setSyncing(false);
      const { total, breakdown, queueHealth } = await pendingUploadStats();
      pendingRef.current = total;
      setPendingCount(total);
      setPendingBreakdown(breakdown);
      writeSyncHealthMeta({ queueHealth });
      setHealth(readSyncHealthMeta());
    }
  }, []);

  const runFlush = useCallback(async (opts?: {
    pull?: boolean;
    forceFull?: boolean;
    showSpinner?: boolean;
    forcePending?: boolean;
  }) => {
    if (!getDeviceOnline() || syncingRef.current) return;
    const now = Date.now();
    let wantPull = opts?.pull === true;
    const forceFull = opts?.forceFull === true;
    const forcePending = opts?.forcePending === true;
    const showSpinner = opts?.showSpinner ?? wantPull;
    const pendingWork = hasPendingSyncWork(pendingRef.current);

    if (wantPull && pullPaused) {
      wantPull = false;
    }

    if (
      !forcePending &&
      !wantPull &&
      now - lastPushAtRef.current < MIN_PUSH_INTERVAL_MS &&
      !pendingWork
    ) {
      return;
    }
    if (wantPull && !forceFull && !forcePending && now - lastFullSyncAtRef.current < MIN_FULL_SYNC_INTERVAL_MS) {
      if (now - lastPushAtRef.current < MIN_PUSH_INTERVAL_MS && !pendingWork) return;
    }

    if (!wantPull && pullPaused) {
      await runPosPushFlush({ showSpinner, force: forcePending });
      return;
    }

    syncingRef.current = true;
    if (showSpinner) setSyncing(true);
    const attemptAt = new Date().toISOString();
    writeSyncHealthMeta({ lastAttemptAt: attemptAt });
    setHealth(readSyncHealthMeta());
    try {
      const work = (async () => {
        if (wantPull) {
          const { push, queueFailed } = await syncShopWithCloud({ pull: true, forceFull });
          lastFullSyncAtRef.current = Date.now();
          lastPushAtRef.current = lastFullSyncAtRef.current;
          if (push.fail === 0 && queueFailed === 0) {
            writeSyncHealthMeta({
              lastSuccessAt: attemptAt,
              lastIssueCode: "none",
              lastIssueAt: null,
            });
          } else {
            writeSyncHealthMeta({ lastIssueAt: attemptAt, lastIssueCode: "partial" });
          }
        } else {
          const { push, queueFailed } = await pushShopPendingToCloud();
          lastPushAtRef.current = Date.now();
          if (push.fail === 0 && queueFailed === 0 && (push.ok > 0 || pendingRef.current === 0)) {
            writeSyncHealthMeta({
              lastSuccessAt: attemptAt,
              lastIssueCode: "none",
              lastIssueAt: null,
            });
          } else if (push.fail > 0 || queueFailed > 0) {
            writeSyncHealthMeta({ lastIssueAt: attemptAt, lastIssueCode: "partial" });
          }
        }
      })();
      await Promise.race([
        work,
        new Promise<void>((_, reject) => {
          window.setTimeout(() => reject(new Error("sync_timeout")), FLUSH_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      writeSyncHealthMeta({
        lastIssueAt: attemptAt,
        lastIssueCode: "error",
      });
      captureAppException(err, { scope: "sync_flush" });
      appendPilotEvent("sync_failure", "Sync flush failed", { at: attemptAt });
      pilotSyncLog("flush_error", { at: attemptAt });
    } finally {
      syncingRef.current = false;
      if (showSpinner) setSyncing(false);
      const { total, breakdown, queueHealth } = await pendingUploadStats();
      pendingRef.current = total;
      setPendingCount(total);
      setPendingBreakdown(breakdown);
      writeSyncHealthMeta({ queueHealth });
      setHealth(readSyncHealthMeta());
    }
  }, [pullPaused, runPosPushFlush]);

  /** Startup: load queue stats and resume uploads without user action. */
  useEffect(() => {
    if (startupDoneRef.current) return;
    startupDoneRef.current = true;
    refreshQueue();
    if (getDeviceOnline()) {
      runWhenIdle(
        () =>
          void (pullPaused
            ? runPosPushFlush({ showSpinner: false, force: true })
            : runFlush({ pull: true, showSpinner: false, forcePending: true })),
        syncStartupIdleMs(),
      );
    }
  }, [pullPaused, refreshQueue, runFlush, runPosPushFlush]);

  useEffect(() => {
    refreshQueue();
    const id = window.setInterval(refreshQueue, QUEUE_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshQueue]);

  /** Connectivity restored → immediate automatic upload (pull only when not on POS). */
  useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = isOnline;

    if (!wasOnline && isOnline) {
      writeSyncHealthMeta({
        offlineSinceAt: null,
        lastOnlineAt: new Date().toISOString(),
      });
      setHealth(readSyncHealthMeta());
      window.setTimeout(() => {
        void (pullPaused
          ? runPosPushFlush({ showSpinner: false, force: true })
          : runFlush({ pull: true, showSpinner: false, forcePending: true }));
      }, RECONNECT_FLUSH_DELAY_MS);
    } else if (wasOnline && !isOnline) {
      writeSyncHealthMeta({ offlineSinceAt: new Date().toISOString() });
      setHealth(readSyncHealthMeta());
    }
  }, [isOnline, pullPaused, runFlush, runPosPushFlush]);

  /** Periodic background drain — push-only on POS, pull+push elsewhere. */
  useEffect(() => {
    const intervalMs = pullPaused ? POS_PUSH_INTERVAL_MS : AUTO_DRAIN_MS;
    const id = window.setInterval(() => {
      if (!getDeviceOnline() || syncingRef.current) return;
      if (hasPendingSyncWork(pendingRef.current)) {
        void (pullPaused
          ? runPosPushFlush({ showSpinner: false })
          : runFlush({ pull: false, showSpinner: false }));
        return;
      }
      if (!pullPaused && Date.now() - lastFullSyncAtRef.current >= MIN_FULL_SYNC_INTERVAL_MS) {
        void runFlush({ pull: true, showSpinner: false });
      }
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [pullPaused, runFlush, runPosPushFlush]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible" || !getDeviceOnline()) return;
      if (visTimerRef.current) window.clearTimeout(visTimerRef.current);
      visTimerRef.current = window.setTimeout(() => {
        runWhenIdle(
          () =>
            void (pullPaused
              ? runPosPushFlush({ showSpinner: false, force: hasPendingSyncWork(pendingRef.current) })
              : runFlush({
                  pull: hasPendingSyncWork(pendingRef.current),
                  showSpinner: false,
                  forcePending: true,
                })),
          syncVisibilityDelayMs(),
        );
      }, syncVisibilityDelayMs());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (visTimerRef.current) window.clearTimeout(visTimerRef.current);
    };
  }, [pullPaused, runFlush, runPosPushFlush]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = App.addListener("appStateChange", (s) => {
      if (s.isActive && getDeviceOnline()) {
        refreshQueue();
        window.setTimeout(() => {
          runWhenIdle(
            () =>
              void (pullPaused
                ? runPosPushFlush({ showSpinner: false, force: true })
                : runFlush({ pull: true, showSpinner: false, forcePending: true })),
            syncAppResumeDelayMs(),
          );
        }, syncAppResumeDelayMs());
      }
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [pullPaused, runFlush, runPosPushFlush, refreshQueue]);

  let status: SyncStatus = "offline";
  if (isOnline) {
    status = syncing || health.posPushUploadActive ? "syncing" : pendingCount > 0 ? "pending" : "online";
  }

  return {
    isOnline,
    pendingCount,
    pendingBreakdown,
    syncing: syncing || health.posPushUploadActive === true,
    pullPaused,
    status,
    health,
    refreshQueue,
    flush: () => runFlush({ pull: true, showSpinner: true, forcePending: true }),
    flushFull: () => runFlush({ pull: true, forceFull: true, showSpinner: true, forcePending: true }),
  };
}

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const pullPaused = shouldPausePosBackgroundPull(location.pathname);
  const value = useSyncStatusEngine({ pullPaused });
  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus(): SyncStatusApi {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) {
    throw new Error("useSyncStatus must be used within SyncStatusProvider");
  }
  return ctx;
}
