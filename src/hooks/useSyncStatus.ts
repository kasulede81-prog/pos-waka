import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { readSyncQueue } from "../offline/localDb";
import { flushSyncQueue } from "../offline/syncEngine";
import { useOfflineStatus } from "./useOfflineStatus";
import type { SyncStatus } from "../types";

export function useSyncStatus() {
  const { isOnline } = useOfflineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refreshQueue = useCallback(() => {
    void readSyncQueue().then((q) => setPendingCount(q.length));
  }, []);

  const runFlush = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      await flushSyncQueue();
    } finally {
      syncingRef.current = false;
      setSyncing(false);
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

  return { isOnline, pendingCount, syncing, status, refreshQueue, flush: runFlush };
}
