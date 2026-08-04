import { useEffect, useState } from "react";
import {
  POS_COMPACT_DESKTOP_MIN_PX,
  POS_FULL_DESKTOP_MIN_PX,
  resolvePosLayoutMode,
  type PosLayoutMode,
} from "../lib/posLayoutMode";
import { resolvePosLayoutModeZoomSafe } from "../lib/posSellWorkspace";

export { POS_COMPACT_DESKTOP_MIN_PX, POS_FULL_DESKTOP_MIN_PX, resolvePosLayoutMode, type PosLayoutMode };

/** Phase 32.1 — zoom-safe POS layout band (maximized desktop zoom keeps full split). */
export function usePosLayoutMode(): PosLayoutMode {
  const [mode, setMode] = useState<PosLayoutMode>(() =>
    typeof window !== "undefined" ? resolvePosLayoutModeZoomSafe() : "mobile",
  );

  useEffect(() => {
    const sync = () => setMode(resolvePosLayoutModeZoomSafe());
    sync();
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
    };
  }, []);

  return mode;
}
