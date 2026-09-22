import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

const SPOTLIGHT_MS = 2000;

export type HomeTileSpotlightStore = {
  getSnapshot: () => string | null;
  subscribe: (listener: () => void) => () => void;
  setActive: (id: string | null) => void;
};

function createSpotlightStore(): HomeTileSpotlightStore {
  let activeId: string | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => activeId,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setActive: (id) => {
      if (id === activeId) return;
      activeId = id;
      listeners.forEach((listener) => listener());
    },
  };
}

/** Only one home tile animates at a time — cycles every 2s for calm, battery-friendly motion. */
export function useHomeTileSpotlight(tileIds: string[], paused: boolean): HomeTileSpotlightStore {
  const storeRef = useRef<HomeTileSpotlightStore | null>(null);
  if (!storeRef.current) storeRef.current = createSpotlightStore();
  const store = storeRef.current;
  const indexRef = useRef(0);
  const idsKey = tileIds.join("|");

  useEffect(() => {
    if (paused || tileIds.length === 0) {
      store.setActive(null);
      return;
    }

    indexRef.current = 0;
    store.setActive(tileIds[0] ?? null);

    const timer = window.setInterval(() => {
      indexRef.current = (indexRef.current + 1) % tileIds.length;
      store.setActive(tileIds[indexRef.current] ?? null);
    }, SPOTLIGHT_MS);

    return () => window.clearInterval(timer);
  }, [idsKey, paused, store]);

  return store;
}

export function useHomeTileSpotlightActive(store: HomeTileSpotlightStore, tileId: string, eligible: boolean): boolean {
  const getSnapshot = useCallback(
    () => eligible && store.getSnapshot() === tileId,
    [eligible, store, tileId],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot, () => false);
}
