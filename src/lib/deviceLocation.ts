import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export type DevicePosition = { latitude: number; longitude: number };

export type DeviceLocationError = "denied" | "unsupported" | "timeout" | "unknown";

export class DeviceLocationRequestError extends Error {
  reason: DeviceLocationError;

  constructor(reason: DeviceLocationError, message?: string) {
    super(message ?? reason);
    this.name = "DeviceLocationRequestError";
    this.reason = reason;
  }
}

async function ensureNativeLocationPermission(): Promise<void> {
  let status = await Geolocation.checkPermissions();
  if (status.location === "granted" || status.coarseLocation === "granted") return;

  status = await Geolocation.requestPermissions();
  if (status.location === "granted" || status.coarseLocation === "granted") return;

  throw new DeviceLocationRequestError("denied");
}

/** GPS / location for shop setup — uses Capacitor on Android/iOS (WebView geolocation is often blocked). */
export async function getDevicePosition(): Promise<DevicePosition> {
  if (Capacitor.isNativePlatform()) {
    await ensureNativeLocationPermission();
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 25_000,
      });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      throw new DeviceLocationRequestError("denied");
    }
  }

  if (!("geolocation" in navigator)) {
    throw new DeviceLocationRequestError("unsupported");
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new DeviceLocationRequestError("denied"));
        else if (err.code === err.TIMEOUT) reject(new DeviceLocationRequestError("timeout"));
        else reject(new DeviceLocationRequestError("unknown"));
      },
      { enableHighAccuracy: true, timeout: 25_000, maximumAge: 120_000 },
    );
  });
}
