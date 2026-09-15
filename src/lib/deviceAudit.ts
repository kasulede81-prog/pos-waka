import type { AuditAction, AuditLogEntry } from "../types";
import { getOrCreateDeviceId } from "./deviceId";
import { usePosStore } from "../store/usePosStore";
import { enqueueSync } from "../offline/syncEngine";

const MAX_AUDIT = 5000;

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
    const byId = new Map(s.auditLogs.map((e) => [e.id, e]));
    byId.set(entry.id, entry);
    const auditLogs = [...byId.values()]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, MAX_AUDIT);
    return { auditLogs };
  });
  void enqueueSync({
    id: crypto.randomUUID(),
    kind: "audit_log",
    payload: { entry },
    createdAt: entry.at,
    attempts: 0,
  });
}
