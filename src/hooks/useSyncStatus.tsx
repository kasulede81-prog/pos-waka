import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { readSyncQueue } from "../offline/localDb";
import { pullCloudAndMergeIntoStore } from "../offline/cloudSync";
import { flushSyncQueue } from "../offline/syncEngine";
import { useOfflineStatus } from "./useOfflineStatus";
import { readSyncHealthMeta, writeSyncHealthMeta, type SyncHealthMeta } from "../lib/syncMeta";
import type { SyncStatus } from "../types";

export type SyncStatusApi = {
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  status: SyncStatus;
  health: SyncHealthMeta;
  refreshQueue: () => void;
  flush: () => Promise<void>;
};

const SyncStatusContext = createContext<SyncStatusApi | null>(null);

function useSyncStatusEngine(): SyncStatusApi {
  const { isOnline } = useOfflineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [health, setHealth] = useState<SyncHealthMeta>(() => readSyncHealthMeta());
  const syncingRef = useRef(false);

  const refreshQueue = useCallback(() => {
    void readSyncQueue().then((q) => setPendingCount(q.length));
    setHealth(readSyncHealthMeta());
  }, []);

  const runFlush = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    const attemptAt = new Date().toISOString();
    writeSyncHealthMeta({ lastAttemptAt: attemptAt });
    setHealth(readSyncHealthMeta());
    try {
      await pullCloudAndMergeIntoStore();
      const { failed } = await flushSyncQueue();
      if (failed === 0) {
        writeSyncHealthMeta({
          lastSuccessAt: attemptAt,
          lastIssueCode: "none",
          lastIssueAt: null,
        });
      } else {
        writeSyncHealthMeta({
          lastIssueAt: attemptAt,
          lastIssueCode: "partial",
        });
      }
    } catch {
      writeSyncHealthMeta({
        lastIssueAt: attemptAt,
        lastIssueCode: "error",
      });
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      setHealth(readSyncHealthMeta());
      const q = await readSyncQueue();
      setPendingCount(q.length);
    }
  }, []);

  useEffect(() => {
    refreshQueue();
    const id = window.setInterval(refreshQueue, 5000);
    return () => window.clearInterval(id);
  }, [refreshQueue]);

  useEffect(() => {
    if (isOnline) void runFlush();
  }, [isOnline, runFlush]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void runFlush();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [runFlush]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = App.addListener("appStateChange", (s) => {
      if (s.isActive && navigator.onLine) void runFlush();
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [runFlush]);

  let status: SyncStatus = "offline";
  if (isOnline) {
    status = syncing ? "syncing" : pendingCount > 0 ? "pending" : "online";
  }

  return {
    isOnline,
    pendingCount,
    syncing,
    status,
    health,
    refreshQueue,
    flush: runFlush,
  };
}

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const value = useSyncStatusEngine();
  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus(): SyncStatusApi {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) {
    throw new Error("useSyncStatus must be used within SyncStatusProvider");
  }
  return ctx;
}
