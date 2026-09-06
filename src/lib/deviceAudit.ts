import type { AuditAction, AuditLogEntry } from "../types";
import { getOrCreateDeviceId } from "./deviceId";
import { usePosStore } from "../store/usePosStore";
import { enqueueSync } from "../offline/syncEngine";
import { applyAuditActiveCap, mergeAuditLogEntriesById } from "./auditActiveCap";
import { AUDIT_RETENTION_MAX_COUNT } from "./auditHealth";

/** Append a local audit row and queue cloud mirror (used outside store mutations). */
export function appendDeviceAuditEntry(
  action: AuditAction,
  payloadSummary: string,
  payload: Record<string, unknown>,
): void {
  const actor = usePosStore.getState().sessionActor;
  const entry: AuditLogEntry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    deviceId: getOrCreateDeviceId(),
    actorUserId: actor?.userId ?? "system",
    actorName: actor?.displayName,
    role: actor?.role ?? "owner",
    action,
    payloadSummary,
    payload,
  };
  usePosStore.setState((s) => {
    const merged = applyAuditActiveCap(
      mergeAuditLogEntriesById(s.auditLogs, [entry]),
      s.archivedAuditLogs,
      AUDIT_RETENTION_MAX_COUNT,
    );
    return { auditLogs: merged.auditLogs, archivedAuditLogs: merged.archivedAuditLogs };
  });
  void enqueueSync({
    id: crypto.randomUUID(),
    kind: "audit_log",
    payload: { entry },
    createdAt: entry.at,
    attempts: 0,
  });
}
