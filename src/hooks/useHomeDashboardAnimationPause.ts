import { useSyncExternalStore } from "react";

type BatteryManager = {
  level: number;
  charging: boolean;
  addEventListener: (event: string, listener: () => void) => void;
  removeEventListener: (event: string, listener: () => void) => void;
};

type Connection = {
  saveData?: boolean;
  addEventListener?: (event: string, listener: () => void) => void;
  removeEventListener?: (event: string, listener: () => void) => void;
};

const listeners = new Set<() => void>();
let initialized = false;
let paused = false;
let manualPause = false;
let lowBattery = false;

function resolvePaused(): boolean {
  if (typeof window === "undefined") return false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hidden = document.visibilityState === "hidden";
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  return manualPause || reducedMotion || hidden || Boolean(connection?.saveData) || lowBattery;
}

function publishPauseState() {
  const next = resolvePaused();
  if (next === paused && initialized) return;
  paused = next;
  document.documentElement.toggleAttribute("data-home-anim-paused", paused);
  listeners.forEach((listener) => listener());
}

function initialize() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  motion.addEventListener("change", publishPauseState);
  document.addEventListener("visibilitychange", publishPauseState);
  connection?.addEventListener?.("change", publishPauseState);

  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
  if (nav.getBattery) {
    void nav.getBattery().then((manager) => {
      const syncBattery = () => {
        lowBattery = !manager.charging && manager.level < 0.2;
        publishPauseState();
      };
      manager.addEventListener("levelchange", syncBattery);
      manager.addEventListener("chargingchange", syncBattery);
      syncBattery();
    });
  }
  publishPauseState();
}

function subscribe(listener: () => void) {
  initialize();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Existing and future manual controls use the same Home motion gate. */
export function setHomeDashboardAnimationPaused(next: boolean) {
  manualPause = next;
  if (typeof document !== "undefined") publishPauseState();
}

/** Canonical Home animation state: manual, reduced motion, visibility, Data Saver, and battery. */
export function useHomeDashboardAnimationPause(): boolean {
  return useSyncExternalStore(subscribe, () => paused, () => false);
}
