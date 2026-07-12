/**
 * Offline queue for staff creates/updates — cloud confirmation required; never silently discard.
 */

import { enqueueSync } from "../offline/syncEngine";
import type { StaffAccount } from "../types";
import { pushStaffToCloud } from "./shopStaffCloud";

const STAFF_SYNC_KIND = "pending_staff" as const;

export type PendingStaffSyncPayload = {
  action: "create" | "update" | "delete" | "reset_secret";
  staff: StaffAccount;
  staffCloudId?: string | null;
};

export async function enqueuePendingStaffSync(payload: PendingStaffSyncPayload): Promise<void> {
  await enqueueSync({
    id: `staff:${payload.action}:${payload.staff.id}:${Date.now()}`,
    kind: STAFF_SYNC_KIND,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastAttemptAt: null,
  });
}

export async function processPendingStaffSync(payload: PendingStaffSyncPayload): Promise<boolean> {
  if (payload.action === "delete") {
    const { deleteCloudStaff } = await import("./shopStaffCloud");
    const { resolveShopCtx } = await import("../offline/cloudSync");
    const ctx = await resolveShopCtx();
    if (!ctx) return false;
    const cloudId = payload.staffCloudId ?? payload.staff.id;
    return deleteCloudStaff(ctx.shopId, cloudId);
  }
  const ok = await pushStaffToCloud(payload.staff);
  if (!ok) return false;

  const { refreshStaffCacheAfterOwnerMutation } = await import("./staffCacheSync");
  await refreshStaffCacheAfterOwnerMutation();

  const { upsertStaffAccountInStore } = await import("./staffSyncApply");
  await upsertStaffAccountInStore({ ...payload.staff, pendingCloudSync: false });

  return true;
}

export function staffRowPendingCloudConfirmation(staff: StaffAccount): boolean {
  return staff.pendingCloudSync === true;
}

export async function createStaffInCloudFirst(
  row: StaffAccount,
  opts?: { isOnline: boolean },
): Promise<{ ok: true; id: string } | { ok: false; queued: boolean; errorKey: string }> {
  const online = opts?.isOnline ?? (typeof navigator !== "undefined" ? navigator.onLine : true);

  if (!online) {
    await enqueuePendingStaffSync({ action: "create", staff: row });
    return { ok: false, queued: true, errorKey: "staffCreateCloudRequired" };
  }

  const pushed = await pushStaffToCloud(row);
  if (!pushed) {
    await enqueuePendingStaffSync({ action: "create", staff: row });
    return { ok: false, queued: true, errorKey: "staffCreateCloudRequired" };
  }

  const { refreshStaffCacheAfterOwnerMutation } = await import("./staffCacheSync");
  await refreshStaffCacheAfterOwnerMutation();

  const { upsertStaffAccountInStore } = await import("./staffSyncApply");
  await upsertStaffAccountInStore({ ...row, pendingCloudSync: false });

  const { usePosStore } = await import("../store/usePosStore");
  const confirmed = (usePosStore.getState().preferences.staffAccounts ?? []).find((a) => a.id === row.id);
  return { ok: true, id: confirmed?.id ?? row.id };
}
