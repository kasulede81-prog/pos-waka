import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { usePosViewportWidth } from "../../../hooks/usePosViewportWidth";
import { usePosStore } from "../../../store/usePosStore";
import { inventoryViewEngineMeta, resolveInventoryViewMode } from "./InventoryViewEngine";
import { readInventoryViewPreference, writeInventoryViewPreference } from "./InventoryViewPersistence";
import type { InventoryViewMode, InventoryViewPreference } from "./types";

type InventoryViewContextValue = {
  preference: InventoryViewPreference;
  mode: InventoryViewMode;
  band: ReturnType<typeof inventoryViewEngineMeta>["band"];
  rowEstimatePx: number;
  setPreference: (next: InventoryViewPreference) => void;
  setModeOverride: (mode: InventoryViewMode) => void;
};

const InventoryViewContext = createContext<InventoryViewContextValue | null>(null);

type ProviderProps = {
  children: ReactNode;
};

export function InventoryViewProvider({ children }: ProviderProps) {
  const viewportWidth = usePosViewportWidth();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const preference = readInventoryViewPreference(preferences);

  const mode = useMemo(
    () => resolveInventoryViewMode({ viewportWidthPx: viewportWidth, preference }),
    [viewportWidth, preference],
  );

  const meta = useMemo(() => inventoryViewEngineMeta(viewportWidth, mode), [viewportWidth, mode]);

  const setPreference = useCallback(
    (next: InventoryViewPreference) => {
      setPreferences(writeInventoryViewPreference(preferences, next));
    },
    [preferences, setPreferences],
  );

  const setModeOverride = useCallback(
    (nextMode: InventoryViewMode) => {
      setPreferences(writeInventoryViewPreference(preferences, nextMode));
    },
    [preferences, setPreferences],
  );

  const value = useMemo<InventoryViewContextValue>(
    () => ({
      preference,
      mode,
      band: meta.band,
      rowEstimatePx: meta.rowEstimatePx,
      setPreference,
      setModeOverride,
    }),
    [preference, mode, meta.band, meta.rowEstimatePx, setPreference, setModeOverride],
  );

  return <InventoryViewContext.Provider value={value}>{children}</InventoryViewContext.Provider>;
}

export function useInventoryView(): InventoryViewContextValue {
  const ctx = useContext(InventoryViewContext);
  if (!ctx) {
    throw new Error("useInventoryView requires InventoryViewProvider");
  }
  return ctx;
}

export function useInventoryViewOptional(): InventoryViewContextValue | null {
  return useContext(InventoryViewContext);
}
