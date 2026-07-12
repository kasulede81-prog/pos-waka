import type { ShopDeviceRow } from "./shopDevices";
import { isRescueDeviceOnline, RESCUE_DEVICE_ONLINE_MS } from "./rescueDeviceList";

/** Matches Internal Admin rescue console — device seen within 15 minutes. */
export const DEVICE_PRESENCE_ONLINE_MS = RESCUE_DEVICE_ONLINE_MS;

/** Recently active window before marking offline (1 hour). */
export const DEVICE_PRESENCE_RECENT_MS = 60 * 60 * 1000;

export type DevicePresenceState = "online" | "recently_active" | "offline" | "unknown";

function latestActivityIso(
  device: Pick<ShopDeviceRow, "last_seen_at" | "last_sync_at" | "last_login_at">,
): string | null {
  const candidates = [device.last_seen_at, device.last_sync_at, device.last_login_at].filter(Boolean) as string[];
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestMs = Date.parse(best);
  for (const iso of candidates.slice(1)) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = iso;
      bestMs = ms;
    }
  }
  return Number.isFinite(bestMs) ? best : null;
}

/** Heartbeat-first presence: last_seen → last_sync → last_login. */
export function resolveDevicePresence(
  device: Pick<ShopDeviceRow, "last_seen_at" | "last_sync_at" | "last_login_at" | "status">,
  nowMs: number = Date.now(),
): DevicePresenceState {
  if (isRescueDeviceOnline(device.last_seen_at, nowMs)) {
    return "online";
  }

  const activityIso = latestActivityIso(device);
  if (!activityIso) {
    return device.status === "active" ? "unknown" : "offline";
  }

  const ageMs = nowMs - Date.parse(activityIso);
  if (!Number.isFinite(ageMs) || ageMs < 0) return "unknown";
  if (ageMs < DEVICE_PRESENCE_ONLINE_MS) return "online";
  if (ageMs < DEVICE_PRESENCE_RECENT_MS) return "recently_active";
  return "offline";
}

export function logDeviceFleetDiagnostic(event: string, detail?: Record<string, unknown>): void {
  if (detail && Object.keys(detail).length > 0) {
    console.info(`[waka-device] ${event}`, detail);
    return;
  }
  console.info(`[waka-device] ${event}`);
}

export function shortDeviceFingerprint(fingerprint: string | null | undefined): string {
  const fp = (fingerprint ?? "").trim();
  if (!fp) return "—";
  if (fp.length <= 10) return fp;
  return `${fp.slice(0, 4)}…${fp.slice(-4)}`;
}
