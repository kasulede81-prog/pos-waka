import { useSyncExternalStore, type ReactNode } from "react";
import { resolveDesktopDensityEnabled, subscribeDesktopDensity } from "../lib/desktopDensity";

function getDesktopDensitySnapshot(): boolean {
  return resolveDesktopDensityEnabled();
}

function getDesktopDensityServerSnapshot(): boolean {
  return false;
}

/** True when `html.waka-desktop-density` should be (and is) applied. */
export function useDesktopDensityEnabled(): boolean {
  return useSyncExternalStore(
    subscribeDesktopDensity,
    getDesktopDensitySnapshot,
    getDesktopDensityServerSnapshot,
  );
}

/** Keeps the document class in sync with platform + viewport. Presentation only. */
export function DesktopDensityRoot({ children }: { children: ReactNode }) {
  useDesktopDensityEnabled();
  return children;
}
