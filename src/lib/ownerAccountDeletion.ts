/**
 * Owner self-service permanent account deletion.
 */

import type { User } from "@supabase/supabase-js";
import { getActiveAccountKey } from "../offline/accountScope";
import { wipeAccountNamespace } from "./accountDataWipe";
import type { HardDeleteVerificationReport } from "./hardDeleteReport";
import { markOrganizationDeleted } from "./organizationDeletionState";
import {
  clearOwnerDeletePartialFailure,
  readOwnerDeletePartialFailure,
  writeOwnerDeletePartialFailure,
} from "./ownerDeletePartialFailure";
import { assertRecentOwnerDeleteReauth } from "./ownerDeleteReauth";
import { supabase } from "./supabase";

export type OwnerAccountDeletionErrorCode =
  | "reauth_required"
  | "migration_not_deployed"
  | "function_not_deployed"
  | "permission_denied"
  | "network"
  | "partial"
  | "verification_failed"
  | "unknown";

export type OwnerAccountDeletionResult = {
  ok: boolean;
  message?: string;
  partial?: boolean;
  sales_deleted?: number;
  devices_deactivated?: number;
  deletion_report?: HardDeleteVerificationReport;
  errorCode?: OwnerAccountDeletionErrorCode;
};

type EdgeDeletePayload = {
  ok?: boolean;
  error?: string;
  detail?: string;
  message?: string;
  partial?: boolean;
  sales_deleted?: number;
  devices_deactivated?: number;
  shop_id?: string;
  shop_name?: string;
  organization_id?: string;
  shop_ids?: string[];
  staff_user_ids?: string[];
  deletion_report?: HardDeleteVerificationReport;
  retry?: boolean;
};

function classifyDeletionError(
  error: string | undefined,
  detail: string | undefined,
  message: string | undefined,
  transportCode?: string,
): OwnerAccountDeletionErrorCode {
  const code = String(error ?? "").toLowerCase();
  const blob = `${detail ?? ""} ${message ?? ""}`.toLowerCase();

  if (code === "reauth_required" || blob.includes("reauth")) return "reauth_required";
  if (
    code === "migration_not_deployed" ||
    blob.includes("migration 112") ||
    blob.includes("migration 111") ||
    blob.includes("health_probe")
  ) {
    return "migration_not_deployed";
  }
  if (transportCode === "function_not_deployed" || code === "function_not_deployed") {
    return "function_not_deployed";
  }
  if (code === "forbidden" || code === "permission_denied" || blob.includes("forbidden")) {
    return "permission_denied";
  }
  if (transportCode === "timeout" || blob.includes("timeout") || blob.includes("network")) {
    return "network";
  }
  if (code === "verification_failed") return "verification_failed";
  if (code === "auth_delete_failed" || code === "partial") return "partial";
  return "unknown";
}

function mapEdgePayload(
  j: EdgeDeletePayload,
  transportMessage?: string,
  transportCode?: string,
): OwnerAccountDeletionResult {
  if (j.ok) {
    return {
      ok: true,
      message: j.message ?? "Account permanently deleted.",
      sales_deleted: j.sales_deleted,
      devices_deactivated: j.devices_deactivated,
      deletion_report: j.deletion_report,
    };
  }

  const errorCode = classifyDeletionError(j.error, j.detail, j.message ?? transportMessage, transportCode);
  const message =
    j.message ?? j.detail ?? transportMessage ?? j.error ?? "Permanent delete failed.";

  if (j.error === "confirmation_required") {
    return { ok: false, message: j.detail ?? "Confirmation text did not match.", errorCode: "unknown" };
  }
  if (j.error === "forbidden") {
    return {
      ok: false,
      message: j.detail ?? "Only the shop owner can delete this account.",
      errorCode: "permission_denied",
    };
  }
  if (j.error === "cannot_delete_internal_admin") {
    return {
      ok: false,
      message: j.detail ?? "This account cannot be self-deleted.",
      errorCode: "permission_denied",
    };
  }
  if (j.error === "migration_not_deployed") {
    return {
      ok: false,
      message: j.detail ?? "Database migration not deployed. Contact Waka support or run supabase db push.",
      errorCode: "migration_not_deployed",
    };
  }
  if (j.error === "reauth_required") {
    return {
      ok: false,
      message: j.detail ?? "Confirm your password or Google account, then retry.",
      errorCode: "reauth_required",
    };
  }
  if (j.error === "verification_failed") {
    writeOwnerDeletePartialFailure({
      shopId: j.shop_id ?? null,
      shopName: j.shop_name ?? null,
      organizationId: j.organization_id ?? null,
      shopIds: j.shop_ids ?? [],
      staffUserIds: j.staff_user_ids ?? [],
      message,
      deletionReport: j.deletion_report ?? null,
    });
    return {
      ok: false,
      partial: true,
      message,
      errorCode: "verification_failed",
      deletion_report: j.deletion_report,
      sales_deleted: j.sales_deleted,
      devices_deactivated: j.devices_deactivated,
    };
  }
  if (j.error === "auth_delete_failed" || j.partial) {
    writeOwnerDeletePartialFailure({
      shopId: j.shop_id ?? null,
      shopName: j.shop_name ?? null,
      organizationId: j.organization_id ?? null,
      shopIds: j.shop_ids ?? [],
      staffUserIds: j.staff_user_ids ?? [],
      message,
      deletionReport: j.deletion_report ?? null,
    });
    return {
      ok: false,
      partial: true,
      message,
      errorCode: "partial",
      deletion_report: j.deletion_report,
      sales_deleted: j.sales_deleted,
      devices_deactivated: j.devices_deactivated,
    };
  }

  return {
    ok: false,
    message,
    errorCode,
    partial: j.partial,
    deletion_report: j.deletion_report,
  };
}

async function invokeOwnerDeleteEdge(body: Record<string, unknown>): Promise<OwnerAccountDeletionResult> {
  const { invokeSupabaseEdgeFunction } = await import("./supabaseEdgeInvoke");
  const r = await invokeSupabaseEdgeFunction<EdgeDeletePayload>("owner-permanently-delete-account", body, {
    deployScript: "supabase:deploy:admin",
  });

  if (!r.ok) {
    return {
      ok: false,
      message: r.message,
      errorCode: classifyDeletionError(undefined, r.message, r.message, r.errorCode),
    };
  }

  return mapEdgePayload(r.data);
}

export async function ownerPermanentlyDeleteOwnAccount(
  confirmation: string,
  user: User | null,
): Promise<OwnerAccountDeletionResult> {
  const reauth = assertRecentOwnerDeleteReauth(user);
  if (!reauth.ok) {
    return { ok: false, message: reauth.message, errorCode: "reauth_required" };
  }

  return invokeOwnerDeleteEdge({ confirmation: confirmation.trim() });
}

export async function retryOwnerAuthDeletion(user: User | null): Promise<OwnerAccountDeletionResult> {
  const reauth = assertRecentOwnerDeleteReauth(user);
  if (!reauth.ok) {
    return { ok: false, message: reauth.message, errorCode: "reauth_required" };
  }

  const partial = readOwnerDeletePartialFailure();
  const result = await invokeOwnerDeleteEdge({
    retry_auth: true,
    shop_id: partial?.shopId ?? undefined,
    organization_id: partial?.organizationId ?? undefined,
    shop_ids: partial?.shopIds ?? [],
    staff_user_ids: partial?.staffUserIds ?? [],
  });

  if (result.ok) {
    clearOwnerDeletePartialFailure();
  }

  return result;
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

  clearOwnerDeletePartialFailure();

  if (supabase) {
    await supabase.auth.signOut().catch(() => undefined);
  }
}

/** Mark org deleted locally before cloud call completes — blocks sync on this device during delete. */
export function markOwnerDeletionInProgress(userId: string | null): void {
  const accountKey = getActiveAccountKey();
  if (!accountKey) return;
  markOrganizationDeleted({
    accountKey,
    userId: userId ?? undefined,
    source: "manual",
    pending: true,
  });
}
