import { useEffect, useState, type RefObject } from "react";
import { catalogColumnCount } from "../lib/posProductGridColumns";
import type { DisplayScaleLevel } from "../lib/displayScale/scaleTokens";

export type CatalogContainerMetrics = {
  containerWidth: number;
  columnCount: number;
};

export type CatalogContainerWidthOptions = {
  displayScale?: DisplayScaleLevel;
  /** Phone layout band — forces 2/3 columns (Phase 28.1). */
  phoneBand?: boolean;
};

function readLandscape(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(orientation: landscape)").matches;
}

/** Tracks catalog container width via ResizeObserver (not viewport width). */
export function useCatalogContainerWidth(
  catalogRef: RefObject<HTMLElement | null>,
  displayScaleOrOptions: DisplayScaleLevel | CatalogContainerWidthOptions = "normal",
): CatalogContainerMetrics {
  const options: CatalogContainerWidthOptions =
    typeof displayScaleOrOptions === "string"
      ? { displayScale: displayScaleOrOptions }
      : displayScaleOrOptions;
  const displayScale = options.displayScale ?? "normal";
  const phoneBand = Boolean(options.phoneBand);

  const [metrics, setMetrics] = useState<CatalogContainerMetrics>(() => ({
    containerWidth: 0,
    columnCount: catalogColumnCount(0, {
      displayScale,
      phoneBand,
      isLandscape: false,
    }),
  }));

  useEffect(() => {
    const el = catalogRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const width = el.getBoundingClientRect().width;
      setMetrics({
        containerWidth: width,
        columnCount: catalogColumnCount(width, {
          displayScale,
          phoneBand,
          isLandscape: readLandscape(),
        }),
      });
    };

    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);

    const mq = window.matchMedia("(orientation: landscape)");
    const onOrientation = () => measure();
    mq.addEventListener("change", onOrientation);
    window.addEventListener("resize", onOrientation);

    return () => {
      observer.disconnect();
      mq.removeEventListener("change", onOrientation);
      window.removeEventListener("resize", onOrientation);
    };
  }, [catalogRef, displayScale, phoneBand]);

  return metrics;
}

/** @deprecated Use useCatalogContainerWidth */
export function useCatalogGridColumns(catalogRef: RefObject<HTMLElement | null>): number {
  return useCatalogContainerWidth(catalogRef).columnCount;
}
