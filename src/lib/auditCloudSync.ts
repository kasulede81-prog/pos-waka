import type { AuditLogEntry } from "../types";
import { hasSupabaseConfig, supabase } from "./supabase";
import { reportSyncIssue } from "./monitoring";

const AUDIT_SELECT =
  "id, shop_id, actor_user_id, role, action, payload_summary, payload, device_id, client_entry_id, created_at";

function rowToAuditEntry(row: Record<string, unknown>): AuditLogEntry | null {
  const clientId = typeof row.client_entry_id === "string" ? row.client_entry_id : null;
  const serverId = typeof row.id === "string" ? row.id : null;
  const id = clientId ?? serverId;
  if (!id) return null;
  const action = String(row.action ?? "");
  if (!action) return null;
  return {
    id,
    at: String(row.created_at ?? new Date().toISOString()),
    deviceId: typeof row.device_id === "string" ? row.device_id : undefined,
    actorUserId: String(row.actor_user_id ?? "unknown"),
    actorName: undefined,
    role: (typeof row.role === "string" ? row.role : "cashier") as AuditLogEntry["role"],
    action: action as AuditLogEntry["action"],
    payloadSummary: String(row.payload_summary ?? ""),
    payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
  };
}

export async function pullAuditLogsFromCloud(shopId: string): Promise<AuditLogEntry[]> {
  if (!hasSupabaseConfig || !supabase || !shopId) return [];

  const out: AuditLogEntry[] = [];
  const pageSize = 500;
  let offset = 0;

  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select(AUDIT_SELECT)
      .eq("shop_id", shopId)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      reportSyncIssue("audit_log_pull_failed", { shopId, code: (error as { code?: string }).code ?? "unknown" });
      break;
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const entry = rowToAuditEntry(row);
      if (entry) out.push(entry);
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

/** Merge cloud audit rows into local logs without duplicates (by entry id). */
export function mergeAuditLogsFromCloudPull(
  localActive: AuditLogEntry[],
  localArchived: AuditLogEntry[],
  cloud: AuditLogEntry[],
): { auditLogs: AuditLogEntry[]; archivedAuditLogs: AuditLogEntry[]; added: number } {
  const seen = new Set<string>();
  for (const e of localActive) seen.add(e.id);
  for (const e of localArchived) seen.add(e.id);

  const added: AuditLogEntry[] = [];
  for (const e of cloud) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    added.push(e);
  }

  if (added.length === 0) {
    return { auditLogs: localActive, archivedAuditLogs: localArchived, added: 0 };
  }

  const mergedArchived = [...localArchived, ...added].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
  );
  return { auditLogs: localActive, archivedAuditLogs: mergedArchived, added: added.length };
}
