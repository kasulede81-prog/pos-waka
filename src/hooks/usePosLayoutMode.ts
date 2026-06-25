import { useEffect, useState } from "react";
import {
  POS_COMPACT_DESKTOP_MIN_PX,
  POS_FULL_DESKTOP_MIN_PX,
  resolvePosLayoutMode,
  type PosLayoutMode,
} from "../lib/posLayoutMode";

export { POS_COMPACT_DESKTOP_MIN_PX, POS_FULL_DESKTOP_MIN_PX, resolvePosLayoutMode, type PosLayoutMode };

export function usePosLayoutMode(): PosLayoutMode {
  const [mode, setMode] = useState<PosLayoutMode>(() =>
    typeof window !== "undefined" ? resolvePosLayoutMode(window.innerWidth) : "mobile",
  );

  useEffect(() => {
    const sync = () => setMode(resolvePosLayoutMode(window.innerWidth));
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  return mode;
}
