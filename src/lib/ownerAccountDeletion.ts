/**
 * Owner self-service permanent account deletion.
 */

import type { User } from "@supabase/supabase-js";
import { getActiveAccountKey } from "../offline/accountScope";
import { wipeAccountNamespace } from "./accountDataWipe";
import type { HardDeleteVerificationReport } from "./hardDeleteReport";
import {
  clearDeletionMarker,
  isDeletionPending,
  markOrganizationDeleted,
} from "./organizationDeletionState";
import {
  clearOwnerDeletePartialFailure,
  readOwnerDeletePartialFailure,
  writeOwnerDeletePartialFailure,
} from "./ownerDeletePartialFailure";
import { assertRecentOwnerDeleteReauth } from "./ownerDeleteReauth";
import {
  classifyOwnerDeletionFailure,
  ownerFacingDeletionMessage,
  sanitizeOwnerDeletionMessage,
  type OwnerDeletionFailureKind,
} from "./ownerDeletionErrors";
import { supabase } from "./supabase";

export type OwnerAccountDeletionErrorCode =
  | "reauth_required"
  | "function_unavailable"
  | "permission_denied"
  | "network"
  | "partial"
  | "validation"
  | "delete_failed"
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

function kindToErrorCode(kind: OwnerDeletionFailureKind): OwnerAccountDeletionErrorCode {
  switch (kind) {
    case "REAUTH_REQUIRED":
    case "AUTH_REQUIRED":
      return "reauth_required";
    case "FUNCTION_UNAVAILABLE":
      return "function_unavailable";
    case "NETWORK_ERROR":
      return "network";
    case "VALIDATION_ERROR":
      return "validation";
    case "PARTIAL_DELETE":
      return "partial";
    case "DELETE_FAILED":
      return "delete_failed";
    default:
      return "unknown";
  }
}

function mapEdgePayload(
  j: EdgeDeletePayload,
  transportMessage?: string,
  transportCode?: string,
): OwnerAccountDeletionResult {
  if (j.ok) {
    return {
      ok: true,
      message: "Account permanently deleted.",
      sales_deleted: j.sales_deleted,
      devices_deactivated: j.devices_deactivated,
      deletion_report: j.deletion_report,
    };
  }

  const kind = classifyOwnerDeletionFailure({
    error: j.error,
    detail: j.detail,
    message: j.message ?? transportMessage,
    transportCode,
    partial: j.partial,
  });
  const errorCode = kindToErrorCode(kind);
  const message = ownerFacingDeletionMessage(kind);

  if (j.error === "forbidden" || j.error === "cannot_delete_internal_admin") {
    return {
      ok: false,
      message,
      errorCode: "permission_denied",
    };
  }

  if (kind === "PARTIAL_DELETE") {
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
    partial: false,
    deletion_report: j.deletion_report,
  };
}

async function invokeOwnerDeleteEdge(body: Record<string, unknown>): Promise<OwnerAccountDeletionResult> {
  const { invokeSupabaseEdgeFunction } = await import("./supabaseEdgeInvoke");
  const r = await invokeSupabaseEdgeFunction<EdgeDeletePayload>("owner-permanently-delete-account", body);

  if (!r.ok) {
    const kind = classifyOwnerDeletionFailure({
      error: undefined,
      detail: r.message,
      message: r.message,
      transportCode: r.errorCode,
    });
    return {
      ok: false,
      message: sanitizeOwnerDeletionMessage(r.message, kind),
      errorCode: kindToErrorCode(kind),
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
    return { ok: false, message: ownerFacingDeletionMessage("REAUTH_REQUIRED"), errorCode: "reauth_required" };
  }

  return invokeOwnerDeleteEdge({ confirmation: confirmation.trim() });
}

export async function retryOwnerAuthDeletion(user: User | null): Promise<OwnerAccountDeletionResult> {
  const reauth = assertRecentOwnerDeleteReauth(user);
  if (!reauth.ok) {
    return { ok: false, message: ownerFacingDeletionMessage("REAUTH_REQUIRED"), errorCode: "reauth_required" };
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

/**
 * Phase 39.1 — after a failed deletion (server still intact), clear transient pending marker
 * so the device does not stay blocked indefinitely.
 */
export function clearOwnerDeletionPendingOnFailure(): void {
  const accountKey = getActiveAccountKey();
  if (!accountKey) return;
  if (isDeletionPending(accountKey)) {
    clearDeletionMarker(accountKey);
  }
}

/**
 * Phase 39.1 — cloud data removed but auth cleanup incomplete: escalate pending → deleted
 * (keep ops blocked) without wiping local namespace yet.
 */
export function escalateOwnerDeletionPendingAfterPartialCloudSuccess(userId: string | null): void {
  const accountKey = getActiveAccountKey();
  if (!accountKey) return;
  markOrganizationDeleted({
    accountKey,
    userId: userId ?? undefined,
    source: "manual",
    pending: false,
  });
}
