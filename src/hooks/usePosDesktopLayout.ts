import { useEffect, useState } from "react";
import { POS_DESKTOP_LAYOUT_MIN_PX, usesPosDesktopLayout } from "../lib/tabletLayout";

export { POS_DESKTOP_LAYOUT_MIN_PX, usesPosDesktopLayout };

export function usePosDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" ? usesPosDesktopLayout(window.innerWidth) : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${POS_DESKTOP_LAYOUT_MIN_PX}px)`);
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return desktop;
}
