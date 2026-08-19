import { Capacitor } from "@capacitor/core";
import { isElectronDesktop } from "../lib/electronDesktop";
import type { WakaPlatform } from "./types";

/** True when Electron preload exposed the desktop bridge. */
export function hasWakaDesktopBridge(): boolean {
  return typeof window !== "undefined" && Boolean(window.wakaDesktop);
}

/**
 * Deterministic shell resolver.
 *
 * Order:
 * 1. Capacitor native → mobile (Android/iOS)
 * 2. Electron bridge or trusted desktop signal → desktop
 * 3. Otherwise → web
 */
export function getPlatform(): WakaPlatform {
  if (typeof window === "undefined") return "web";
  if (Capacitor.isNativePlatform()) return "mobile";
  if (hasWakaDesktopBridge() || isElectronDesktop()) return "desktop";
  return "web";
}

export function isWebPlatform(): boolean {
  return getPlatform() === "web";
}

export function isMobilePlatform(): boolean {
  return getPlatform() === "mobile";
}

export function isDesktopPlatform(): boolean {
  return getPlatform() === "desktop";
}
