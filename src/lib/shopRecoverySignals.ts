import { getAuthRecoveryUrl } from "./authConfig";
import { hasSupabaseConfig, supabase } from "./supabase";

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

/**
 * Apply server-side admin PIN reset on this device.
 * Bypasses setPreferences auth — support recovery must always win over local session role.
 */
export async function applyAdminBackOfficePinClear(shopId: string, clearedAt: string): Promise<boolean> {
  const lastApplied = readAppliedPinClearAt(shopId);
  if (lastApplied === clearedAt) return false;

  const { clearLegacySensitiveSession, clearSecuritySession } = await import(
    "./enterpriseSecurity/securitySession"
  );
  clearSecuritySession();
  clearLegacySensitiveSession();

  const { flushPendingPersist, usePosStore } = await import("../store/usePosStore");
  usePosStore.setState((s) => ({
    preferences: {
      ...s.preferences,
      backOfficePin: null,
      posLocked: false,
      biometricAuthEnabled: false,
    },
  }));

  usePosStore.getState().logAuditAction(
    "admin_pin_clear_applied",
    "Shop Security PIN cleared by support recovery",
    { shopId, clearedAt },
  );

  writeAppliedPinClearAt(shopId, clearedAt);
  flushPendingPersist();

  const { applyShopSecurityPinRecoveryClear } = await import("./shopSecurityPinSync");
  applyShopSecurityPinRecoveryClear(shopId);

  void import("./cloudSnapshotSync").then(({ uploadShopCloudSnapshot }) => {
    void uploadShopCloudSnapshot({ force: true });
  });

  return true;
}

/** Apply server-side admin PIN reset on this device (after cloud sync / login). */
export async function applyShopRecoverySignalsForCurrentShop(): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase) return false;

  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx) return false;

  return applyShopRecoverySignalsForShop(ctx.shopId);
}

/** Fetch and apply recovery signals for a shop — safe to call before cloud pull. */
export async function applyShopRecoverySignalsForShop(shopId: string): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase) return false;

  const rpc = supabase.rpc("shop_fetch_recovery_signal", { p_shop_id: shopId });
  const { data, error } = await Promise.race([
    rpc,
    new Promise<{ data: null; error: { message: string } }>((resolve) => {
      setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), 4_000);
    }),
  ]);
  if (error || !data || typeof data !== "object") return false;

  const clearedAt = String((data as { clear_back_office_pin_at?: string }).clear_back_office_pin_at ?? "").trim();
  if (!clearedAt) return false;

  return applyAdminBackOfficePinClear(shopId, clearedAt);
}

/** Proactive check on app load / unlock screens — does not require full sync. */
export async function ensureShopRecoveryApplied(): Promise<boolean> {
  return applyShopRecoverySignalsForCurrentShop();
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
