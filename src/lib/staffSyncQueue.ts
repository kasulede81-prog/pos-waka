/**
 * Offline queue for staff creates/updates — cloud confirmation required; never silently discard.
 * Phase 25.1 — staff ACK pull + unified cache mirror after cloud commit.
 * Phase 25.1A — PIN reset uses the same pending_staff queue + ACK propagation.
 */

import { enqueueSync } from "../offline/syncEngine";
import type { StaffAccount } from "../types";
import { pushStaffToCloud } from "./shopStaffCloud";
import { pickNewerStaffAccount } from "./staffRecovery";
import {
  logStaffPinResetQueued,
  logStaffPinResetStarted,
  recordStaffAckLatency,
  recordStaffCreateLatency,
  recordStaffPinResetAckLatency,
  recordStaffPinResetRetry,
  recordStaffQueueDepth,
} from "./staffSyncDiagnostics";

const STAFF_SYNC_KIND = "pending_staff" as const;

export type PendingStaffSyncPayload = {
  action: "create" | "update" | "delete" | "reset_secret";
  staff: StaffAccount;
  staffCloudId?: string | null;
};

export type StaffSecretResetField = "pin" | "password" | "both";

export async function enqueuePendingStaffSync(payload: PendingStaffSyncPayload): Promise<void> {
  const opId = `staff:${payload.action}:${payload.staff.id}`;
  await enqueueSync({
    id: opId,
    kind: STAFF_SYNC_KIND,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastAttemptAt: null,
  });
  void import("../offline/localDb").then(({ readSyncQueue }) => {
    void readSyncQueue().then((q) => {
      const depth = q.filter((row) => row.kind === STAFF_SYNC_KIND).length;
      recordStaffQueueDepth(depth);
    });
  });
}

/** After cloud staff mutation ACK — refresh cache and trigger event-driven pull on all devices. */
export async function afterStaffCloudAck(
  source: "create" | "update" | "delete" | "reset_secret" | "queue",
): Promise<void> {
  const started = performance.now();
  const { refreshStaffCacheAfterOwnerMutation } = await import("./staffCacheSync");
  await refreshStaffCacheAfterOwnerMutation();
  const { scheduleImmediateStaffPull } = await import("./immediateSync");
  scheduleImmediateStaffPull(source === "reset_secret" ? "staff_ack" : source);
  recordStaffAckLatency(performance.now() - started, source);
}

/** Resolve the staff row to push — live store wins when newer; skip safely when deleted. */
export async function resolveStaffForPendingPush(
  payload: PendingStaffSyncPayload,
): Promise<StaffAccount | null> {
  if (payload.action === "delete") return null;

  const { usePosStore } = await import("../store/usePosStore");
  const live = usePosStore.getState().preferences.staffAccounts?.find((a) => a.id === payload.staff.id);

  if (!live) {
    if (payload.action === "reset_secret" || payload.action === "update") return null;
    return payload.staff;
  }

  if (payload.action === "create") {
    return live.pendingCloudSync ? live : pickNewerStaffAccount(payload.staff, live);
  }

  return pickNewerStaffAccount(payload.staff, live);
}

export async function processPendingStaffSync(payload: PendingStaffSyncPayload): Promise<boolean> {
  if (payload.action === "delete") {
    const { deleteCloudStaff } = await import("./shopStaffCloud");
    const { resolveShopCtx } = await import("../offline/cloudSync");
    const ctx = await resolveShopCtx();
    if (!ctx) return false;
    const cloudId = payload.staffCloudId ?? payload.staff.id;
    const ok = await deleteCloudStaff(ctx.shopId, cloudId);
    if (ok) await afterStaffCloudAck("delete");
    return ok;
  }

  const staff = await resolveStaffForPendingPush(payload);
  if (!staff) {
    return payload.action === "reset_secret" || payload.action === "update";
  }

  const ok = await pushStaffToCloud(staff);
  if (!ok) {
    if (payload.action === "reset_secret") {
      recordStaffPinResetRetry(staff.id);
    }
    return false;
  }

  await afterStaffCloudAck(payload.action === "reset_secret" ? "reset_secret" : "queue");

  const { upsertStaffAccountInStore } = await import("./staffSyncApply");
  await upsertStaffAccountInStore({ ...staff, pendingCloudSync: false });

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

  const createStarted = performance.now();
  const pushed = await pushStaffToCloud(row);
  if (!pushed) {
    await enqueuePendingStaffSync({ action: "create", staff: row });
    return { ok: false, queued: true, errorKey: "staffCreateCloudRequired" };
  }

  await afterStaffCloudAck("create");
  recordStaffCreateLatency(performance.now() - createStarted);

  const { upsertStaffAccountInStore } = await import("./staffSyncApply");
  await upsertStaffAccountInStore({ ...row, pendingCloudSync: false });

  const { usePosStore } = await import("../store/usePosStore");
  const confirmed = (usePosStore.getState().preferences.staffAccounts ?? []).find((a) => a.id === row.id);
  return { ok: true, id: confirmed?.id ?? row.id };
}

/** Cloud-first PIN/password reset — queue + retry on failure (Phase 25.1A). */
export async function syncStaffSecretResetInCloud(
  staff: StaffAccount,
  opts?: { isOnline?: boolean; field?: StaffSecretResetField },
): Promise<{ ok: boolean; queued?: boolean }> {
  const online = opts?.isOnline ?? (typeof navigator !== "undefined" ? navigator.onLine : true);
  const field = opts?.field ?? "pin";

  logStaffPinResetStarted(staff.id, field);

  if (!online) {
    await enqueuePendingStaffSync({ action: "reset_secret", staff });
    logStaffPinResetQueued(staff.id);
    return { ok: false, queued: true };
  }

  const started = performance.now();
  const pushed = await pushStaffToCloud(staff);
  if (!pushed) {
    await enqueuePendingStaffSync({ action: "reset_secret", staff });
    logStaffPinResetQueued(staff.id);
    return { ok: false, queued: true };
  }

  await afterStaffCloudAck("reset_secret");
  recordStaffPinResetAckLatency(performance.now() - started);
  return { ok: true };
}
