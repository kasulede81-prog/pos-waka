import { useEffect, useState } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Pauses living dashboard motion when tab hidden, data saver on, or low battery. */
export function useHomeDashboardAnimationPause(): boolean {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPaused(true);
      document.documentElement.setAttribute("data-home-anim-paused", "");
      return;
    }

    let lowBattery = false;

    const sync = () => {
      const hidden = document.visibilityState === "hidden";
      const saveData = Boolean(
        (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData,
      );
      const shouldPause = hidden || saveData || lowBattery;
      setPaused(shouldPause);
      if (shouldPause) document.documentElement.setAttribute("data-home-anim-paused", "");
      else document.documentElement.removeAttribute("data-home-anim-paused");
    };

    sync();
    document.addEventListener("visibilitychange", sync);

    let battery: {
      level: number;
      charging: boolean;
      addEventListener: (e: string, fn: () => void) => void;
      removeEventListener: (e: string, fn: () => void) => void;
    } | null = null;

    const onBattery = () => {
      if (!battery) return;
      lowBattery = !battery.charging && battery.level < 0.2;
      sync();
    };

    const nav = navigator as Navigator & {
      getBattery?: () => Promise<typeof battery>;
    };
    if (nav.getBattery) {
      void nav.getBattery().then((bat) => {
        if (!bat) return;
        battery = bat;
        onBattery();
        bat.addEventListener("levelchange", onBattery);
        bat.addEventListener("chargingchange", onBattery);
      });
    }

    return () => {
      document.removeEventListener("visibilitychange", sync);
      document.documentElement.removeAttribute("data-home-anim-paused");
      if (battery) {
        battery.removeEventListener("levelchange", onBattery);
        battery.removeEventListener("chargingchange", onBattery);
      }
    };
  }, []);

  return paused;
}
