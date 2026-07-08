import { useEffect, useState } from "react";
import { WAKA_MEDIA, WAKA_TABLET_MIN_PX } from "../lib/responsiveBreakpoints";
import { usesPosDesktopLayout } from "../lib/tabletLayout";

export { usesPosDesktopLayout, WAKA_TABLET_MIN_PX as POS_DESKTOP_LAYOUT_MIN_PX };

export function usePosDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" ? usesPosDesktopLayout(window.innerWidth) : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(WAKA_MEDIA.posDesktopLayout);
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return desktop;
}
