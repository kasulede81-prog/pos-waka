import { Capacitor } from "@capacitor/core";
import { getOrCreateDeviceId } from "./deviceId";
import { getDeviceOnline } from "./deviceOnline";
import { supabase } from "./supabase";

const HEARTBEAT_MIN_INTERVAL_MS = 3 * 60 * 1000;
const STORAGE_KEY = "waka.presence.lastHeartbeatAt";

let inFlight: Promise<void> | null = null;

function readLastHeartbeatMs(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLastHeartbeatMs(ms: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

function presencePlatform(): string {
  if (typeof window === "undefined") return "server";
  if (Capacitor.isNativePlatform()) return Capacitor.getPlatform();
  return "web";
}

function presenceLabel(): string {
  const platform = presencePlatform();
  if (platform === "android") return "Android POS";
  if (platform === "ios") return "iOS POS";
  return "Web POS";
}

/** Registers this device and refreshes shop last_seen_at (throttled). */
export async function sendShopPresenceHeartbeat(shopId: string): Promise<void> {
  if (!shopId || !supabase || !getDeviceOnline()) return;

  const now = Date.now();
  if (now - readLastHeartbeatMs() < HEARTBEAT_MIN_INTERVAL_MS) return;

  if (inFlight) {
    await inFlight.catch(() => {});
    if (now - readLastHeartbeatMs() < HEARTBEAT_MIN_INTERVAL_MS) return;
  }

  inFlight = (async () => {
    const { error } = await supabase.rpc("shop_device_heartbeat", {
      p_shop_id: shopId,
      p_device_fingerprint: getOrCreateDeviceId(),
      p_label: presenceLabel(),
      p_platform: presencePlatform(),
      p_app_version: import.meta.env.VITE_APP_VERSION ?? "1.0.0",
    });
    if (!error) writeLastHeartbeatMs(Date.now());
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
