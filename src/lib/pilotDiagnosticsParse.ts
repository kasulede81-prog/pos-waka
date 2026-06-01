import type { PilotDiagnosticsExport } from "./pilotDiagnostics";
import { PILOT_REQUIRED_MIGRATIONS } from "./pilotDiagnostics";

export type ParsedPilotDiagnostics = {
  raw: Record<string, unknown>;
  valid: boolean;
  parseError?: string;
  shopId: string | null;
  appVersion: string;
  deviceId: string;
  plan: string;
  effectiveRole: string;
  cloudRole: string | null;
  businessType: string;
  authMode: string;
  pendingSyncQueue: number;
  pendingBreakdown: Record<string, number>;
  unsyncedSales: number;
  syncErrorCount: number;
  syncErrors: Array<{ id: string; error: string; createdAt?: string }>;
  syncHealth: Record<string, unknown>;
  requiredMigrations: string[];
  migrationNote: string;
  exportedAt: string | null;
  pilotModeEnabled: boolean;
  recentEvents: Array<{ at: string; kind: string; summary: string }>;
  issueNote: string | null;
  screenshotFileName: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function parsePilotDiagnosticsJson(text: string): ParsedPilotDiagnostics | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    return normalizeParsedDiagnostics(raw);
  } catch (e) {
    return {
      raw: {},
      valid: false,
      parseError: e instanceof Error ? e.message : "Invalid JSON",
      shopId: null,
      appVersion: "—",
      deviceId: "—",
      plan: "—",
      effectiveRole: "—",
      cloudRole: null,
      businessType: "—",
      authMode: "—",
      pendingSyncQueue: 0,
      pendingBreakdown: {},
      unsyncedSales: 0,
      syncErrorCount: 0,
      syncErrors: [],
      syncHealth: {},
      requiredMigrations: [...PILOT_REQUIRED_MIGRATIONS],
      migrationNote: "",
      exportedAt: null,
      pilotModeEnabled: false,
      recentEvents: [],
      issueNote: null,
      screenshotFileName: null,
    };
  }
}

export function normalizeParsedDiagnostics(raw: Record<string, unknown>): ParsedPilotDiagnostics {
  const breakdown = asRecord(raw.pendingSyncBreakdown) ?? {};
  const syncErrorsRaw = raw.syncErrors;
  const syncErrors = Array.isArray(syncErrorsRaw)
    ? syncErrorsRaw.map((row) => {
        const r = asRecord(row) ?? {};
        return {
          id: String(r.id ?? ""),
          error: String(r.error ?? ""),
          createdAt: r.createdAt != null ? String(r.createdAt) : r.created_at != null ? String(r.created_at) : undefined,
        };
      })
    : [];

  const eventsRaw = raw.recentPilotEvents ?? raw.pilotEvents;
  const recentEvents = Array.isArray(eventsRaw)
    ? eventsRaw.map((row) => {
        const r = asRecord(row) ?? {};
        return { at: String(r.at ?? ""), kind: String(r.kind ?? ""), summary: String(r.summary ?? "") };
      })
    : [];

  return {
    raw,
    valid: true,
    shopId: raw.shopId != null ? String(raw.shopId) : null,
    appVersion: String(raw.appVersion ?? raw.app_version ?? "—"),
    deviceId: String(raw.deviceId ?? raw.device_id ?? "—"),
    plan: String(raw.plan ?? "—"),
    effectiveRole: String(raw.effectiveRole ?? raw.effective_role ?? "—"),
    cloudRole: raw.cloudRole != null ? String(raw.cloudRole) : raw.cloud_role != null ? String(raw.cloud_role) : null,
    businessType: String(raw.businessType ?? raw.business_type ?? "—"),
    authMode: String(raw.authMode ?? raw.auth_mode ?? "—"),
    pendingSyncQueue: num(raw.pendingSyncQueue ?? raw.pending_sync_queue),
    pendingBreakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, num(v)])),
    unsyncedSales: num(raw.unsyncedSales ?? raw.unsynced_sales),
    syncErrorCount: num(raw.syncErrorCount ?? raw.sync_error_count),
    syncErrors,
    syncHealth: asRecord(raw.syncHealth) ?? asRecord(raw.sync_health) ?? {},
    requiredMigrations: Array.isArray(raw.requiredMigrations)
      ? (raw.requiredMigrations as string[])
      : [...PILOT_REQUIRED_MIGRATIONS],
    migrationNote: String(raw.migrationNote ?? raw.migration_note ?? ""),
    exportedAt: raw.at != null ? String(raw.at) : null,
    pilotModeEnabled: Boolean(raw.pilotModeEnabled ?? raw.pilot_mode_enabled),
    recentEvents,
    issueNote: raw.issueNote != null ? String(raw.issueNote) : null,
    screenshotFileName:
      raw.screenshotFileName != null
        ? String(raw.screenshotFileName)
        : raw.screenshot_file_name != null
          ? String(raw.screenshot_file_name)
          : null,
  };
}

export function parsedFromExport(d: PilotDiagnosticsExport): ParsedPilotDiagnostics {
  return normalizeParsedDiagnostics(d as unknown as Record<string, unknown>);
}
