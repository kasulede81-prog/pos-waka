import { useEffect, useRef, useState } from "react";

const SPOTLIGHT_MS = 2000;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Only one home tile animates at a time — cycles every 2s for calm, battery-friendly motion. */
export function useHomeTileSpotlight(tileIds: string[], paused: boolean): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  const indexRef = useRef(0);
  const idsKey = tileIds.join("|");

  useEffect(() => {
    if (paused || prefersReducedMotion() || tileIds.length === 0) {
      setActiveId(null);
      return;
    }

    indexRef.current = 0;
    setActiveId(tileIds[0] ?? null);

    const timer = window.setInterval(() => {
      indexRef.current = (indexRef.current + 1) % tileIds.length;
      setActiveId(tileIds[indexRef.current] ?? null);
    }, SPOTLIGHT_MS);

    return () => window.clearInterval(timer);
  }, [idsKey, paused, tileIds]);

  return activeId;
}
