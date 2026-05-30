import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { shouldPausePosBackgroundWork } from "../lib/backgroundWorkPolicy";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { getDeviceOnline } from "../lib/deviceOnline";
import { isNativeApp } from "../lib/nativeApp";
import { nativeSyncResumeDelayMs, nativeVisibilitySyncDelayMs, runWhenIdle } from "../lib/uiYield";
import { readSyncQueue } from "../offline/localDb";
import { pushShopPendingToCloud, syncShopWithCloud } from "../offline/cloudSync";
import { useOfflineStatus } from "./useOfflineStatus";
import { readSyncHealthMeta, writeSyncHealthMeta, type SyncHealthMeta } from "../lib/syncMeta";
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
  status: SyncStatus;
  health: SyncHealthMeta;
  refreshQueue: () => void;
  flush: () => Promise<void>;
  flushFull: () => Promise<void>;
};

const SyncStatusContext = createContext<SyncStatusApi | null>(null);

const QUEUE_POLL_MS = isNativeApp() ? 90_000 : 20_000;
const FLUSH_TIMEOUT_MS = 55_000;
const MIN_PUSH_INTERVAL_MS = isNativeApp() ? 20_000 : 8_000;
const MIN_FULL_SYNC_INTERVAL_MS = isNativeApp() ? 300_000 : 90_000;

function emptyBreakdown(): PendingBreakdown {
  return { sales: 0, stock: 0, returns: 0, expenses: 0, other: 0 };
}

function bucketForKind(kind: SyncOperationKind): keyof PendingBreakdown {
  if (kind === "pending_sales" || kind === "sale") return "sales";
  if (kind === "pending_stock_updates" || kind === "stock_move" || kind === "product" || kind === "purchase") return "stock";
  if (kind === "pending_returns") return "returns";
  if (kind === "pending_expenses") return "expenses";
  return "other";
}

async function pendingUploadStats(): Promise<{ total: number; breakdown: PendingBreakdown }> {
  const queue = await readSyncQueue();
  const breakdown = emptyBreakdown();
  for (const op of queue) {
    const bucket = bucketForKind(op.kind);
    breakdown[bucket] += 1;
  }
  const total = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  return { total, breakdown };
}

function useSyncStatusEngine(opts?: { paused?: boolean }) {
  const paused = opts?.paused === true;
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

  const refreshQueue = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void pendingUploadStats().then(({ total, breakdown }) => {
      pendingRef.current = total;
      setPendingCount(total);
      setPendingBreakdown(breakdown);
    });
    setHealth(readSyncHealthMeta());
  }, []);

  const runFlush = useCallback(async (opts?: { pull?: boolean; forceFull?: boolean; showSpinner?: boolean }) => {
    if (paused || !getDeviceOnline() || syncingRef.current) return;
    const now = Date.now();
    const wantPull = opts?.pull === true;
    const forceFull = opts?.forceFull === true;
    const showSpinner = opts?.showSpinner ?? wantPull;

    if (!wantPull && now - lastPushAtRef.current < MIN_PUSH_INTERVAL_MS && pendingRef.current === 0) {
      return;
    }
    if (wantPull && !forceFull && now - lastFullSyncAtRef.current < MIN_FULL_SYNC_INTERVAL_MS) {
      if (now - lastPushAtRef.current < MIN_PUSH_INTERVAL_MS) return;
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
          if (push.fail === 0 && queueFailed === 0 && push.ok > 0) {
            writeSyncHealthMeta({
              lastSuccessAt: attemptAt,
              lastIssueCode: "none",
              lastIssueAt: null,
            });
          }
        }
      })();
      await Promise.race([
        work,
        new Promise<void>((_, reject) => {
          window.setTimeout(() => reject(new Error("sync_timeout")), FLUSH_TIMEOUT_MS);
        }),
      ]);
    } catch {
      writeSyncHealthMeta({
        lastIssueAt: attemptAt,
        lastIssueCode: "error",
      });
    } finally {
      syncingRef.current = false;
      if (showSpinner) setSyncing(false);
      setHealth(readSyncHealthMeta());
      const { total, breakdown } = await pendingUploadStats();
      pendingRef.current = total;
      setPendingCount(total);
      setPendingBreakdown(breakdown);
    }
  }, [paused]);

  useEffect(() => {
    if (paused) return;
    refreshQueue();
    const id = window.setInterval(refreshQueue, QUEUE_POLL_MS);
    return () => window.clearInterval(id);
  }, [paused, refreshQueue]);

  useEffect(() => {
    if (paused) return;
    if (isOnline) {
      const delay = isNativeApp() ? 12_000 : 1200;
      window.setTimeout(() => {
        if (pendingRef.current === 0 && isNativeApp()) return;
        runWhenIdle(() => void runFlush({ pull: false, showSpinner: false }), isNativeApp() ? 8000 : 1500);
      }, delay);
    }
  }, [isOnline, paused, runFlush]);

  useEffect(() => {
    if (paused) return;
    const onVis = () => {
      if (document.visibilityState !== "visible" || !getDeviceOnline()) return;
      if (visTimerRef.current) window.clearTimeout(visTimerRef.current);
      visTimerRef.current = window.setTimeout(() => {
        runWhenIdle(() => void runFlush({ pull: false }), nativeVisibilitySyncDelayMs());
      }, nativeVisibilitySyncDelayMs());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (visTimerRef.current) window.clearTimeout(visTimerRef.current);
    };
  }, [paused, runFlush]);

  useEffect(() => {
    if (paused) return;
    if (!Capacitor.isNativePlatform()) return;
    const sub = App.addListener("appStateChange", (s) => {
      if (s.isActive && getDeviceOnline()) {
        if (Date.now() - lastPushAtRef.current < MIN_PUSH_INTERVAL_MS) return;
        window.setTimeout(() => {
          runWhenIdle(
            () => void runFlush({ pull: false, showSpinner: false }),
            nativeSyncResumeDelayMs(),
          );
        }, nativeSyncResumeDelayMs());
      }
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [paused, runFlush]);

  let status: SyncStatus = "offline";
  if (isOnline) {
    status = syncing ? "syncing" : pendingCount > 0 ? "pending" : "online";
  }

  return {
    isOnline,
    pendingCount,
    pendingBreakdown,
    syncing,
    status,
    health,
    refreshQueue,
    flush: () => runFlush({ pull: true, showSpinner: true }),
    flushFull: () => runFlush({ pull: true, forceFull: true, showSpinner: true }),
  };
}

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const paused = shouldPausePosBackgroundWork(location.pathname);
  const value = useSyncStatusEngine({ paused });
  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus(): SyncStatusApi {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) {
    throw new Error("useSyncStatus must be used within SyncStatusProvider");
  }
  return ctx;
}
