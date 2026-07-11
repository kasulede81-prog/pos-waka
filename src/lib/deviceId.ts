const KEY = "waka-pos-device-id";

/** Minimum length enforced by shop_device_register_on_login (migration 138). */
const MIN_FINGERPRINT_LENGTH = 8;

function generateFingerprint(): string {
  return crypto.randomUUID();
}

function ensureValidFingerprint(value: string): string {
  if (value.length >= MIN_FINGERPRINT_LENGTH) return value;
  return generateFingerprint();
}

/** Stable per-browser/device id for audit rows and cloud device registration. */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") {
    return ensureValidFingerprint("server-side");
  }
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return ensureValidFingerprint(existing);
    const id = generateFingerprint();
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    return generateFingerprint();
  }
}
