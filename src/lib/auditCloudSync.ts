import type { AuditLogEntry, DataRetentionPolicy } from "../types";
import { hasSupabaseConfig, supabase } from "./supabase";
import { reportSyncIssue } from "./monitoring";
import { restoreActorFromAuditPayload } from "./investigationActorAttribution";
import { AUDIT_RETENTION_MAX_COUNT } from "./auditHealth";
import { applyAuditActiveCap } from "./auditActiveCap";
import { archiveCutoffIso, isBeforeCutoff, normalizeDataRetentionPolicy } from "./dataRetention";

const AUDIT_SELECT =
  "id, shop_id, actor_user_id, role, action, payload_summary, payload, device_id, client_entry_id, created_at";

const AUDIT_PULL_PAGE_SIZE = 500;
const AUDIT_INCREMENTAL_MAX_PAGES = 40;
/** Overlap so a late-uploaded older action timestamp is still visible after the next incremental. */
export const AUDIT_INCREMENTAL_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export type AuditPullProgress = {
  pulled: number;
  page: number;
};

export function auditIncrementalSince(since: string | null): string {
  if (!since) return new Date(0).toISOString();
  const parsed = Date.parse(since);
  if (!Number.isFinite(parsed)) return new Date(0).toISOString();
  return new Date(Math.max(0, parsed - AUDIT_INCREMENTAL_LOOKBACK_MS)).toISOString();
}

/**
 * Map a shop-scoped audit_logs row to the local event model.
 * Identity is client_entry_id (fallback server id). `at` is created_at (push writes entry.at).
 * Actor is restored from payload (RLS coerces actor_user_id to auth.uid()).
 */
export function parseAuditLogCloudRow(
  row: Record<string, unknown>,
  expectedShopId?: string,
): AuditLogEntry | null {
  if (expectedShopId) {
    const rowShop = typeof row.shop_id === "string" ? row.shop_id : "";
    if (rowShop && rowShop !== expectedShopId) return null;
  }
  const clientId = typeof row.client_entry_id === "string" ? row.client_entry_id : null;
  const serverId = typeof row.id === "string" ? row.id : null;
  const id = clientId ?? serverId;
  if (!id) return null;
  const action = String(row.action ?? "");
  if (!action) return null;
  const createdAt = typeof row.created_at === "string" && row.created_at ? row.created_at : "";
  if (!createdAt) return null;
  const raw: AuditLogEntry = {
    id,
    at: createdAt,
    deviceId: typeof row.device_id === "string" ? row.device_id : undefined,
    actorUserId: String(row.actor_user_id ?? "unknown"),
    actorName: undefined,
    role: (typeof row.role === "string" ? row.role : "cashier") as AuditLogEntry["role"],
    action: action as AuditLogEntry["action"],
    payloadSummary: String(row.payload_summary ?? ""),
    payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
  };
  return restoreActorFromAuditPayload(raw);
}

/**
 * Pull all audit logs from cloud with cursor pagination until exhaustion.
 * Callers classify via mergeAuditLogsFromCloudPull (recent → active, old → archived).
 */
export async function pullAuditLogsFromCloud(
  shopId: string,
  opts?: { onProgress?: (progress: AuditPullProgress) => void },
): Promise<AuditLogEntry[]> {
  if (!hasSupabaseConfig || !supabase || !shopId) return [];

  const out: AuditLogEntry[] = [];
  let offset = 0;

  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select(AUDIT_SELECT)
      .eq("shop_id", shopId)
      .order("created_at", { ascending: true })
      .range(offset, offset + AUDIT_PULL_PAGE_SIZE - 1);

    if (error) {
      reportSyncIssue("audit_log_pull_failed", { shopId, code: (error as { code?: string }).code ?? "unknown" });
      break;
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const entry = parseAuditLogCloudRow(row, shopId);
      if (entry) out.push(entry);
    }

    opts?.onProgress?.({ pulled: out.length, page });

    if (rows.length < AUDIT_PULL_PAGE_SIZE) break;
    offset += AUDIT_PULL_PAGE_SIZE;
    const { yieldUiTick } = await import("./uiYield");
    await yieldUiTick();
  }

  return out;
}

export type AuditRecoveryMergeOpts = {
  /** Shop data-retention policy. Defaults to the same 3m policy as archive. */
  policy?: DataRetentionPolicy;
  nowMs?: number;
  /**
   * Explicit archive cutoff (ISO). `null` means forever (all unseen recent enough → active).
   * When omitted, computed from `policy` via archiveCutoffIso.
   */
  cutoffIso?: string | null;
};

export function resolveAuditRecoveryCutoff(opts?: AuditRecoveryMergeOpts): string | null {
  if (opts && Object.prototype.hasOwnProperty.call(opts, "cutoffIso")) {
    return opts.cutoffIso ?? null;
  }
  return archiveCutoffIso(normalizeDataRetentionPolicy(opts?.policy), opts?.nowMs);
}

/**
 * Merge recovered cloud audit rows into local logs without duplicates (by entry id).
 * Recent unseen events (at >= archive cutoff) go to ACTIVE auditLogs so Investigation
 * sees them with includeArchived=false. Older unseen events stay archived.
 * Existing archived rows are not promoted. Local identity wins. Never queues upload.
 */
export function mergeAuditLogsFromCloudPull(
  localActive: AuditLogEntry[],
  localArchived: AuditLogEntry[],
  cloud: AuditLogEntry[],
  opts?: AuditRecoveryMergeOpts,
): { auditLogs: AuditLogEntry[]; archivedAuditLogs: AuditLogEntry[]; added: number } {
  const seen = new Set<string>();
  for (const e of localActive) seen.add(e.id);
  for (const e of localArchived) seen.add(e.id);

  const cutoff = resolveAuditRecoveryCutoff(opts);
  const addedActive: AuditLogEntry[] = [];
  const addedArchived: AuditLogEntry[] = [];

  for (const e of cloud) {
    if (!e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    if (cutoff && isBeforeCutoff(e.at, cutoff)) addedArchived.push(e);
    else addedActive.push(e);
  }

  if (addedActive.length === 0 && addedArchived.length === 0) {
    return { auditLogs: localActive, archivedAuditLogs: localArchived, added: 0 };
  }

  const capped = applyAuditActiveCap(
    [...localActive, ...addedActive],
    [...localArchived, ...addedArchived],
    AUDIT_RETENTION_MAX_COUNT,
  );
  return {
    auditLogs: capped.auditLogs,
    archivedAuditLogs: capped.archivedAuditLogs,
    added: addedActive.length + addedArchived.length,
  };
}

/**
 * Incremental shop audit pull for normal sync.
 * Scoped by shop_id (RLS + query). Does not download the full table: created_at > since − lookback.
 */
export async function pullAuditLogsFromCloudIncremental(
  shopId: string,
  since: string | null,
): Promise<{ entries: AuditLogEntry[]; checkpointAt: string; truncated: boolean }> {
  const fallbackAt = since && Date.parse(since) ? since : new Date().toISOString();
  if (!hasSupabaseConfig || !supabase || !shopId) {
    return { entries: [], checkpointAt: fallbackAt, truncated: false };
  }

  const out: AuditLogEntry[] = [];
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const isCatchUp = !since || !Number.isFinite(sinceMs) || sinceMs <= 0;
  let checkpointAt = isCatchUp ? new Date(0).toISOString() : auditIncrementalSince(since);
  let truncated = false;

  if (isCatchUp) {
    let offset = 0;
    for (let page = 0; page < AUDIT_INCREMENTAL_MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from("audit_logs")
        .select(AUDIT_SELECT)
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false })
        .range(offset, offset + AUDIT_PULL_PAGE_SIZE - 1);

      if (error) {
        reportSyncIssue("audit_log_incremental_pull_failed", {
          shopId,
          code: (error as { code?: string }).code ?? "unknown",
        });
        break;
      }

      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) break;

      for (const row of rows) {
        const entry = parseAuditLogCloudRow(row, shopId);
        if (entry) out.push(entry);
        const created = typeof row.created_at === "string" ? row.created_at : "";
        if (created > checkpointAt) checkpointAt = created;
      }

      if (rows.length < AUDIT_PULL_PAGE_SIZE) break;
      offset += AUDIT_PULL_PAGE_SIZE;
      if (page === AUDIT_INCREMENTAL_MAX_PAGES - 1) truncated = true;
      const { yieldUiTick } = await import("./uiYield");
      await yieldUiTick();
    }
    return {
      entries: out,
      checkpointAt: out.length > 0 ? checkpointAt : fallbackAt,
      truncated,
    };
  }

  let cursor = auditIncrementalSince(since);
  for (let page = 0; page < AUDIT_INCREMENTAL_MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select(AUDIT_SELECT)
      .eq("shop_id", shopId)
      .gt("created_at", cursor)
      .order("created_at", { ascending: true })
      .limit(AUDIT_PULL_PAGE_SIZE);

    if (error) {
      reportSyncIssue("audit_log_incremental_pull_failed", {
        shopId,
        code: (error as { code?: string }).code ?? "unknown",
      });
      break;
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const entry = parseAuditLogCloudRow(row, shopId);
      if (entry) out.push(entry);
      const created = typeof row.created_at === "string" ? row.created_at : "";
      if (created > checkpointAt) checkpointAt = created;
    }

    if (rows.length < AUDIT_PULL_PAGE_SIZE) break;
    cursor = checkpointAt;
    if (page === AUDIT_INCREMENTAL_MAX_PAGES - 1) truncated = true;
    const { yieldUiTick } = await import("./uiYield");
    await yieldUiTick();
  }

  return {
    entries: out,
    checkpointAt: out.length > 0 ? checkpointAt : fallbackAt,
    truncated,
  };
}

/**
 * Merge unseen remote audit events into ACTIVE investigation history.
 * Local identity wins; never overwrites an existing id; never queues upload.
 * Existing 5000-event active cap is preserved; overflow is capacity-archived.
 */
export function applyNormalSyncAuditPull(
  localActive: AuditLogEntry[],
  localArchived: AuditLogEntry[],
  remote: AuditLogEntry[],
): { auditLogs: AuditLogEntry[]; archivedAuditLogs: AuditLogEntry[]; added: number } {
  const seen = new Set<string>();
  for (const e of localActive) seen.add(e.id);
  for (const e of localArchived) seen.add(e.id);

  const added: AuditLogEntry[] = [];
  for (const e of remote) {
    if (!e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    added.push(e);
  }

  if (added.length === 0) {
    return { auditLogs: localActive, archivedAuditLogs: localArchived, added: 0 };
  }

  const capped = applyAuditActiveCap([...localActive, ...added], localArchived, AUDIT_RETENTION_MAX_COUNT);
  return { auditLogs: capped.auditLogs, archivedAuditLogs: capped.archivedAuditLogs, added: added.length };
}
