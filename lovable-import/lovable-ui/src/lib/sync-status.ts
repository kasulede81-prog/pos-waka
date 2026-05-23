import { create } from "zustand";

export type SyncState = "idle" | "syncing" | "queued" | "offline" | "error";

interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncedAt: number | null;
  errorMessage: string | null;
  setState: (s: SyncState) => void;
  setPending: (n: number) => void;
  markSynced: () => void;
  setError: (msg: string | null) => void;
}

export const useSyncStatus = create<SyncStatus>((set) => ({
  state: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "idle",
  pending: 0,
  lastSyncedAt: null,
  errorMessage: null,
  setState: (s) => set({ state: s }),
  setPending: (n) => set({ pending: n }),
  markSynced: () => set({ state: "idle", pending: 0, lastSyncedAt: Date.now(), errorMessage: null }),
  setError: (msg) => set({ state: "error", errorMessage: msg }),
}));

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    useSyncStatus.setState({ state: "idle" });
  });
  window.addEventListener("offline", () => {
    useSyncStatus.setState({ state: "offline" });
  });
}
