import { Capacitor } from "@capacitor/core";

/** Shared online flag for sync (Capacitor Network on native; navigator on web). */
let deviceOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
let trackingStarted = false;

export function getDeviceOnline(): boolean {
  return deviceOnline;
}

function applyDeviceOnline(next: boolean): void {
  const was = deviceOnline;
  deviceOnline = next;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("waka:network-status", { detail: { connected: next } }));
  if (!was && next) {
    window.dispatchEvent(new CustomEvent("waka:network-online"));
  } else if (was && !next) {
    window.dispatchEvent(new CustomEvent("waka:network-offline"));
  }
}

function registerWebOnlineTracking(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  deviceOnline = navigator.onLine;
  window.addEventListener("online", () => applyDeviceOnline(true));
  window.addEventListener("offline", () => applyDeviceOnline(false));
}

/** Start network tracking (call once at app boot). Native: Capacitor Network. Web/Electron: window online/offline. */
export async function initDeviceOnlineTracking(): Promise<void> {
  if (trackingStarted) return;
  trackingStarted = true;

  if (Capacitor.isNativePlatform()) {
    try {
      const { Network } = await import("@capacitor/network");
      const status = await Network.getStatus();
      deviceOnline = status.connected;
      await Network.addListener("networkStatusChange", (s) => {
        applyDeviceOnline(s.connected);
      });
    } catch {
      deviceOnline = typeof navigator !== "undefined" ? navigator.onLine : deviceOnline;
    }
    return;
  }

  // WAKA-04: web / PWA / Electron must mutate the same flag the sync flush gates on.
  registerWebOnlineTracking();
}
