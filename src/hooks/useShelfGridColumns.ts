import { useEffect, useState, type RefObject } from "react";
import { shelfColumnCount } from "../lib/posShelfGridColumns";
import { isWakaMobile } from "../lib/responsiveBreakpoints";
import { usePosViewportWidth } from "./usePosViewportWidth";

function readLandscape(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(orientation: landscape)").matches;
}

/** Container-aware shelf column count (Phase 32.3). */
export function useShelfGridColumns(gridRef: RefObject<HTMLElement | null>): number {
  const viewportWidth = usePosViewportWidth();
  const phoneBand = isWakaMobile(viewportWidth);
  const [columnCount, setColumnCount] = useState(() =>
    shelfColumnCount(viewportWidth || 360, { phoneBand, isLandscape: false }),
  );

  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const width = el.getBoundingClientRect().width;
      setColumnCount(
        shelfColumnCount(width, {
          phoneBand,
          isLandscape: readLandscape(),
        }),
      );
    };

    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", measure);
    };
  }, [gridRef, phoneBand]);

  return columnCount;
}
