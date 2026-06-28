import { useEffect, useRef, useState } from "react";

const SPOTLIGHT_MS = 2800;

const SPOTLIGHT_ZONES = [
  "sign",
  "counter",
  "owner",
  "shelves",
  "printer",
  "cloud",
] as const;

export type BuilderSpotlightZone = (typeof SPOTLIGHT_ZONES)[number];

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One scene zone animates at a time — reuses dashboard spotlight pattern. */
export function useBuilderSpotlight(paused: boolean): BuilderSpotlightZone | null {
  const [active, setActive] = useState<BuilderSpotlightZone | null>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    if (paused || prefersReducedMotion()) {
      setActive(null);
      return;
    }

    indexRef.current = 0;
    setActive(SPOTLIGHT_ZONES[0] ?? null);

    const timer = window.setInterval(() => {
      indexRef.current = (indexRef.current + 1) % SPOTLIGHT_ZONES.length;
      setActive(SPOTLIGHT_ZONES[indexRef.current] ?? null);
    }, SPOTLIGHT_MS);

    return () => window.clearInterval(timer);
  }, [paused]);

  return active;
}
