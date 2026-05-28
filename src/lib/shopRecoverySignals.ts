import { getAuthRecoveryUrl } from "./authConfig";
import { hasSupabaseConfig, supabase } from "./supabase";
import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { usePosStore } from "../store/usePosStore";

const APPLIED_PIN_CLEAR_KEY = "waka.recovery.pinClearApplied.v1";

function appliedPinClearKey(shopId: string): string {
  return `${APPLIED_PIN_CLEAR_KEY}::${shopId}`;
}

function readAppliedPinClearAt(shopId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(appliedPinClearKey(shopId));
  } catch {
    return null;
  }
}

function writeAppliedPinClearAt(shopId: string, at: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(appliedPinClearKey(shopId), at);
  } catch {
    /* ignore */
  }
}

/** Apply server-side admin PIN reset on this device (after cloud sync / login). */
export async function applyShopRecoverySignalsForCurrentShop(): Promise<void> {
  if (!hasSupabaseConfig || !supabase) return;
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return;

  const primary = await resolvePrimaryOrganizationForUser(userId);
  if (!primary?.shopId) return;

  const rpc = supabase.rpc("shop_fetch_recovery_signal", { p_shop_id: primary.shopId });
  const { data, error } = await Promise.race([
    rpc,
    new Promise<{ data: null; error: { message: string } }>((resolve) => {
      setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), 4_000);
    }),
  ]);
  if (error || !data || typeof data !== "object") return;

  const clearedAt = String((data as { clear_back_office_pin_at?: string }).clear_back_office_pin_at ?? "").trim();
  if (!clearedAt) return;

  const lastApplied = readAppliedPinClearAt(primary.shopId);
  if (lastApplied === clearedAt) return;

  usePosStore.getState().setPreferences({ backOfficePin: null, posLocked: false });
  writeAppliedPinClearAt(primary.shopId, clearedAt);
}

/** Send Supabase password recovery email to shop owner (after admin RPC audit). */
export async function sendOwnerPasswordResetEmail(ownerEmail: string): Promise<{ ok: boolean; message?: string }> {
  if (!hasSupabaseConfig || !supabase) {
    return { ok: false, message: "Offline" };
  }
  const email = ownerEmail.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, message: "Invalid owner email." };

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRecoveryUrl(),
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
