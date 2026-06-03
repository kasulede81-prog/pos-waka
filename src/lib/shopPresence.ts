import { Capacitor } from "@capacitor/core";
import { getDeviceOnline } from "./deviceOnline";
import { getOrCreateDeviceId } from "./deviceId";
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

export function presencePlatform(): string {
  if (typeof window === "undefined") return "server";
  if (Capacitor.isNativePlatform()) return Capacitor.getPlatform();
  return "web";
}

export function presenceLabel(): string {
  const platform = presencePlatform();
  if (platform === "android") return "Android POS";
  if (platform === "ios") return "iOS POS";
  return "Web POS";
}

function presencePayload(shopId: string) {
  return {
    p_shop_id: shopId,
    p_device_fingerprint: getOrCreateDeviceId(),
    p_label: presenceLabel(),
    p_platform: presencePlatform(),
    p_app_version: import.meta.env.VITE_APP_VERSION ?? "1.0.0",
  };
}

function parseHeartbeatResult(data: unknown): { accepted?: boolean } {
  if (!data || typeof data !== "object") return {};
  const r = data as Record<string, unknown>;
  return {
    accepted: r.accepted === true || r.ok === true,
  };
}

/** @deprecated Use ensureShopDeviceActivation from deviceActivation.ts */
export async function registerShopDeviceOnLogin(shopId: string) {
  const { registerShopDeviceOnLogin: register } = await import("./deviceActivation");
  return register(shopId);
}

/** Registers this device and refreshes shop last_seen_at (throttled). Never activates disconnected devices. */
export async function sendShopPresenceHeartbeat(shopId: string): Promise<void> {
  if (!shopId || !supabase || !getDeviceOnline()) return;

  const now = Date.now();
  if (now - readLastHeartbeatMs() < HEARTBEAT_MIN_INTERVAL_MS) return;

  if (inFlight) {
    await inFlight.catch(() => {});
    if (now - readLastHeartbeatMs() < HEARTBEAT_MIN_INTERVAL_MS) return;
  }

  inFlight = (async () => {
    const { data, error } = await supabase.rpc("shop_device_heartbeat", presencePayload(shopId));
    if (error) return;
    const parsed = parseHeartbeatResult(data);
    if (parsed.accepted !== false) {
      writeLastHeartbeatMs(Date.now());
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
