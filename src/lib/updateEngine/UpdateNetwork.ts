/**
 * ANDROID-UPDATE-P1 — connectivity for the update path.
 *
 * `navigator.onLine` is unreliable inside the Android WebView (it can report true on a
 * captive/dead network and has reported stale values after doze). The repo already owns
 * a Capacitor Network wrapper (`src/lib/deviceOnline.ts`, initialised from
 * `src/lib/capacitorInit.ts`); this module prefers that, probes Capacitor Network
 * directly on native, and only then falls back to `navigator.onLine`.
 */
import { Capacitor } from "@capacitor/core";
import { getDeviceOnline } from "../deviceOnline";

export type UpdateConnectivity = {
  online: boolean;
  source: "capacitor-network" | "device-online-tracker" | "navigator" | "assumed";
};

export function navigatorOnline(): boolean | null {
  if (typeof navigator === "undefined") return null;
  if (typeof navigator.onLine !== "boolean") return null;
  return navigator.onLine;
}

/** Pure resolver so connectivity precedence is unit-testable. */
export function resolveConnectivity(input: {
  capacitorConnected: boolean | null;
  trackerOnline: boolean | null;
  navigatorOnline: boolean | null;
}): UpdateConnectivity {
  if (input.capacitorConnected !== null) {
    return { online: input.capacitorConnected, source: "capacitor-network" };
  }
  if (input.trackerOnline === false) {
    return { online: false, source: "device-online-tracker" };
  }
  if (input.navigatorOnline !== null) {
    return { online: input.navigatorOnline, source: "navigator" };
  }
  if (input.trackerOnline !== null) {
    return { online: input.trackerOnline, source: "device-online-tracker" };
  }
  return { online: true, source: "assumed" };
}

async function probeCapacitorNetwork(): Promise<boolean | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { Network } = await import("@capacitor/network");
    const status = await Network.getStatus();
    return Boolean(status?.connected);
  } catch {
    return null;
  }
}

export async function readUpdateConnectivity(): Promise<UpdateConnectivity> {
  const capacitorConnected = await probeCapacitorNetwork();
  let trackerOnline: boolean | null = null;
  try {
    trackerOnline = getDeviceOnline();
  } catch {
    trackerOnline = null;
  }
  return resolveConnectivity({
    capacitorConnected,
    trackerOnline,
    navigatorOnline: navigatorOnline(),
  });
}

export async function isUpdatePathOffline(): Promise<boolean> {
  const connectivity = await readUpdateConnectivity();
  return !connectivity.online;
}
