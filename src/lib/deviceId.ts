const KEY = "waka-pos-device-id";

/** Stable per-browser/device id for audit rows (optional field). */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    return "unknown";
  }
}
