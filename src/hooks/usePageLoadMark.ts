import { useEffect } from "react";
import { markPageLoad } from "../lib/performanceMetrics";

/** Record page mount-to-paint timing once per navigation. */
export function usePageLoadMark(page: string): void {
  useEffect(() => {
    const start = performance.now();
    const id = requestAnimationFrame(() => {
      markPageLoad(page, performance.now() - start);
    });
    return () => cancelAnimationFrame(id);
  }, [page]);
}
