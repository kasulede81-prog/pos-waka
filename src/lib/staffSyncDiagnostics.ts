/** Enterprise diagnostics for staff synchronization (Phase 21.4) — never log credentials. */

export type StaffSyncDiagnosticEvent =
  | "merge_applied"
  | "upsert_inserted"
  | "upsert_updated"
  | "duplicates_skipped"
  | "cache_mirror_merge";

const LOG_PREFIX = "[waka-staff-sync]";

const SENSITIVE_KEYS = ["pin", "password", "hash", "secret", "token"];

function sanitizeMeta(meta?: Record<string, string | number | boolean | null>): Record<string, unknown> {
  if (!meta) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) continue;
    safe[key] = value;
  }
  return safe;
}

export function logStaffSyncEvent(
  event: StaffSyncDiagnosticEvent,
  meta?: Record<string, string | number | boolean | null>,
): void {
  console.info(LOG_PREFIX, { event, ...sanitizeMeta(meta) });
}
