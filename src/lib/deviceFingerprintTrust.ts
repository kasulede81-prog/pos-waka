import { getOrCreateDeviceId } from "./deviceId";
import { supabase } from "./supabase";

const LAST_FP_KEY = "waka-pos-device-fp-last";

function readLastFingerprint(): string | null {
  try {
    return localStorage.getItem(LAST_FP_KEY);
  } catch {
    return null;
  }
}

function writeLastFingerprint(fp: string): void {
  try {
    localStorage.setItem(LAST_FP_KEY, fp);
  } catch {
    /* ignore */
  }
}

/** Detect localStorage fingerprint reset and audit server-side; notify owner via audit payload. */
export async function reportDeviceFingerprintChangeIfNeeded(shopId: string): Promise<boolean> {
  if (!supabase || !shopId) return false;
  const current = getOrCreateDeviceId();
  const previous = readLastFingerprint();
  if (!previous) {
    writeLastFingerprint(current);
    return false;
  }
  if (previous === current) return false;

  const { data, error } = await supabase.rpc("shop_device_report_fingerprint_change", {
    p_shop_id: shopId,
    p_previous_fingerprint: previous,
    p_new_fingerprint: current,
  });
  writeLastFingerprint(current);
  if (error) {
    console.warn("[waka-device] fingerprint change report", error.message);
    return false;
  }
  return (data as { notified?: boolean })?.notified === true;
}

export async function notifyOwnerNewDeviceActivation(shopId: string, fingerprint: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc("shop_device_notify_new_activation", {
    p_shop_id: shopId,
    p_device_fingerprint: fingerprint,
  });
}
