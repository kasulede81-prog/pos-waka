/**
 * Owner self-service permanent account deletion.
 */

import { getActiveAccountKey } from "../offline/accountScope";
import { wipeAccountNamespace } from "./accountDataWipe";
import { markOrganizationDeleted } from "./organizationDeletionState";
import { supabase } from "./supabase";

export type OwnerAccountDeletionResult = {
  ok: boolean;
  message?: string;
  partial?: boolean;
  sales_deleted?: number;
};

export async function ownerPermanentlyDeleteOwnAccount(
  confirmation: string,
): Promise<OwnerAccountDeletionResult> {
  const { invokeSupabaseEdgeFunction } = await import("./supabaseEdgeInvoke");
  const r = await invokeSupabaseEdgeFunction<{
    ok?: boolean;
    error?: string;
    detail?: string;
    message?: string;
    partial?: boolean;
    sales_deleted?: number;
  }>("owner-permanently-delete-account", {
    confirmation: confirmation.trim(),
  });

  if (!r.ok) {
    return { ok: false, message: r.message };
  }

  const j = r.data;
  if (j.ok) {
    return {
      ok: true,
      message: j.message ?? "Account permanently deleted.",
      sales_deleted: j.sales_deleted,
    };
  }

  if (j.error === "confirmation_required") {
    return { ok: false, message: j.detail ?? "Confirmation text did not match." };
  }
  if (j.error === "forbidden") {
    return { ok: false, message: j.detail ?? "Only the shop owner can delete this account." };
  }
  if (j.error === "cannot_delete_internal_admin") {
    return { ok: false, message: j.detail ?? "This account cannot be self-deleted." };
  }
  if (j.error === "auth_delete_failed" || j.partial) {
    return {
      ok: false,
      partial: true,
      message:
        j.message ??
        j.detail ??
        "Shop data was removed but login still exists. Contact support before registering again.",
    };
  }

  return {
    ok: false,
    message: j.detail ?? j.message ?? j.error ?? "Permanent delete failed.",
    partial: j.partial,
  };
}

/** Wipe local device data and clear session after successful cloud deletion. */
export async function finalizeOwnerAccountDeletionLocally(userId: string | null): Promise<void> {
  const accountKey = getActiveAccountKey();
  if (accountKey) {
    markOrganizationDeleted({
      accountKey,
      userId: userId ?? undefined,
      source: "manual",
    });
    await wipeAccountNamespace(accountKey).catch(() => undefined);
  }

  if (supabase) {
    await supabase.auth.signOut().catch(() => undefined);
  }
}
