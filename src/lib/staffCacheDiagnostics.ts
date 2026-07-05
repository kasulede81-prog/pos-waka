/**
 * Structured diagnostics for offline staff cache (Phase 3).
 */

import { appendPilotEvent } from "./pilotEventLog";

export type StaffCacheDiagnosticEvent =
  | "staff_cache_loaded"
  | "staff_cache_version"
  | "staff_delta_download"
  | "staff_login_offline"
  | "staff_login_online"
  | "staff_cache_refresh"
  | "staff_cache_missing"
  | "staff_version_changed";

export function logStaffCacheEvent(
  event: StaffCacheDiagnosticEvent,
  meta?: Record<string, string | number | boolean | null>,
): void {
  appendPilotEvent("other", `Staff cache: ${event}`, { event, ...meta });
}
