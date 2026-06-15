import { useEffect, useState } from "react";

/** Tailwind `lg` — desktop split-view POS from 1024px. */
export const POS_DESKTOP_LAYOUT_MIN_PX = 1024;

export function usesPosDesktopLayout(widthPx: number): boolean {
  return widthPx >= POS_DESKTOP_LAYOUT_MIN_PX;
}

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
