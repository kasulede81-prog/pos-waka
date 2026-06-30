import { getOrCreateDeviceId } from "../deviceId";
import {
  clampDisplayScaleLevel,
  DEFAULT_DISPLAY_SCALE_LEVEL,
  type DisplayScaleLevel,
} from "./scaleTokens";

const STORAGE_PREFIX = "waka-pos-display-scale-v1";

function storageKey(): string {
  return `${STORAGE_PREFIX}:${getOrCreateDeviceId()}`;
}

/** Per-device display scale — survives logout, restart, offline. Never synced to cloud. */
export function loadDisplayScaleLevel(): DisplayScaleLevel {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_SCALE_LEVEL;
  try {
    return clampDisplayScaleLevel(window.localStorage.getItem(storageKey()));
  } catch {
    return DEFAULT_DISPLAY_SCALE_LEVEL;
  }
}

export function saveDisplayScaleLevel(level: DisplayScaleLevel): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(), level);
    window.dispatchEvent(new CustomEvent("waka:display-scale-changed", { detail: { level } }));
  } catch {
    /* ignore quota */
  }
}
