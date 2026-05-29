import { Capacitor } from "@capacitor/core";

/** Shared online flag for sync (Capacitor Network on native; navigator on web). */
let deviceOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

export function getDeviceOnline(): boolean {
  return deviceOnline;
}

/** Start native network tracking (call once at app boot). */
export async function initDeviceOnlineTracking(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Network } = await import("@capacitor/network");
    const status = await Network.getStatus();
    deviceOnline = status.connected;
    await Network.addListener("networkStatusChange", (s) => {
      deviceOnline = s.connected;
      window.dispatchEvent(new CustomEvent("waka:network-status", { detail: { connected: s.connected } }));
    });
  } catch {
    deviceOnline = navigator.onLine;
  }
}
