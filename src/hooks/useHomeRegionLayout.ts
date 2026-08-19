import { useEffect, useMemo, useState } from "react";
import {
  resolveHomeRegionLayout,
  resolveHomeRegionOrder,
  type HomeBodyRegionId,
  type HomeRegionLayout,
} from "../lib/homePresentation";
import { WAKA_MEDIA, WAKA_POS_WIDE_MIN_PX } from "../lib/responsiveBreakpoints";

export type HomeRegionLayoutState = HomeRegionLayout & {
  regionOrder: HomeBodyRegionId[];
};

/** Live Home + Settings preview — same lg / xl media as Tailwind. */
export function useHomeRegionLayout(): HomeRegionLayoutState {
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 0,
  );

  useEffect(() => {
    const sync = () => setWidth(window.innerWidth);
    sync();
    const lg = window.matchMedia(WAKA_MEDIA.desktopUp);
    const xl = window.matchMedia(`(min-width: ${WAKA_POS_WIDE_MIN_PX}px)`);
    lg.addEventListener("change", sync);
    xl.addEventListener("change", sync);
    return () => {
      lg.removeEventListener("change", sync);
      xl.removeEventListener("change", sync);
    };
  }, []);

  return useMemo(() => {
    const layout = resolveHomeRegionLayout(width);
    return {
      ...layout,
      regionOrder: resolveHomeRegionOrder(layout.largeScreen),
    };
  }, [width]);
}
