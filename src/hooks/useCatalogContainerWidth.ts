import { useEffect, useState, type RefObject } from "react";
import { catalogColumnCount } from "../lib/posProductGridColumns";

export type CatalogContainerMetrics = {
  containerWidth: number;
  columnCount: number;
};

/** Tracks catalog container width via ResizeObserver (not viewport width). */
export function useCatalogContainerWidth(catalogRef: RefObject<HTMLElement | null>): CatalogContainerMetrics {
  const [metrics, setMetrics] = useState<CatalogContainerMetrics>({ containerWidth: 0, columnCount: 3 });

  useEffect(() => {
    const el = catalogRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const width = el.getBoundingClientRect().width;
      setMetrics({ containerWidth: width, columnCount: catalogColumnCount(width) });
    };

    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [catalogRef]);

  return metrics;
}

/** @deprecated Use useCatalogContainerWidth */
export function useCatalogGridColumns(catalogRef: RefObject<HTMLElement | null>): number {
  return useCatalogContainerWidth(catalogRef).columnCount;
}
