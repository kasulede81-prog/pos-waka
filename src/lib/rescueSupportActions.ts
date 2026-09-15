import { supabase } from "./supabase";

export type RescueSupportAction =
  | "rescue_password_reset"
  | "rescue_pin_reset"
  | "rescue_staff_credentials_reset"
  | "rescue_force_logout"
  | "rescue_retry_sync"
  | "rescue_reset_sync"
  | "rescue_refresh_diagnostics"
  | "rescue_verification_email"
  | "rescue_suspend_shop"
  | "rescue_reactivate_shop"
  | "rescue_revoke_device_trust"
  | "rescue_device_reset_sync"
  | "rescue_open_support_notes"
  | "rescue_whatsapp_contact"
  | "rescue_copy_contact";

export type LogRescueActionInput = {
  shopId?: string | null;
  action: RescueSupportAction | string;
  result: "ok" | "failed" | "skipped";
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logRescueSupportAction(input: LogRescueActionInput): Promise<{ ok: boolean; message?: string }> {
  return logInternalAdminAudit(input);
}

/** Unified internal admin audit writer (shop console, fleet, billing, etc.). */
export async function logInternalAdminAudit(input: LogRescueActionInput): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };

  const { data: userData } = await supabase.auth.getUser();
  const actor = userData.user?.id ?? null;

  const payload: Record<string, unknown> = {
    result: input.result,
    reason: input.reason ?? null,
    at: new Date().toISOString(),
    console: "internal_admin",
    ...(input.metadata ?? {}),
  };

  const row: Record<string, unknown> = {
    actor,
    action: input.action,
    payload,
  };
  if (input.shopId) row.target_shop_id = input.shopId;

  const { error } = await supabase.from("internal_ops_admin_audit").insert(row);

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function fetchShopRecoverySignals(
  shopId: string,
): Promise<{
  clearBackOfficePinAt: string | null;
  clearStaffCredentialsAt: string | null;
  passwordResetRequestedAt: string | null;
}> {
  if (!supabase) {
    return { clearBackOfficePinAt: null, clearStaffCredentialsAt: null, passwordResetRequestedAt: null };
  }
  const { data, error } = await supabase.rpc("shop_fetch_recovery_signal", { p_shop_id: shopId });
  if (error || !data || typeof data !== "object") {
    return { clearBackOfficePinAt: null, clearStaffCredentialsAt: null, passwordResetRequestedAt: null };
  }
  const j = data as Record<string, unknown>;
  return {
    clearBackOfficePinAt: j.clear_back_office_pin_at != null ? String(j.clear_back_office_pin_at) : null,
    clearStaffCredentialsAt: j.clear_staff_credentials_at != null ? String(j.clear_staff_credentials_at) : null,
    passwordResetRequestedAt:
      j.password_reset_requested_at != null ? String(j.password_reset_requested_at) : null,
  };
}

export async function fetchShopCloudSnapshotForRescue(
  shopId: string,
): Promise<{ snapshot: unknown; updatedAt: string | null } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("shop_cloud_snapshots")
    .select("snapshot, updated_at")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    snapshot: data.snapshot,
    updatedAt: data.updated_at != null ? String(data.updated_at) : null,
  };
}
