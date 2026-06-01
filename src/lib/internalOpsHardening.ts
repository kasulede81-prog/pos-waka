import { supabase } from "./supabase";
import type { PilotDiagnosticsExport } from "./pilotDiagnostics";

export type SharedInternalNote = {
  id: string;
  body: string;
  author: string;
  created_at: string;
};

export type PilotShopRow = {
  id: string;
  shop_number: string | null;
  name: string;
  business_type: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  pilot_cohort: boolean;
  plan_code: string | null;
  pending_outbound: number;
  last_error: string | null;
  last_push_ok_at: string | null;
  app_version: string | null;
  crashes_today: number;
  risk_score: number;
  health_status: string;
};

export type PilotDashboardMetrics = {
  total_pilot_shops: number;
  active_pilot_shops: number;
  at_risk_pilot_shops: number;
  shops_sync_failure: number;
  shops_queue_overload: number;
  shops_offline_24h: number;
  shops_outdated_version: number;
  pilot_revenue_ugx_30d: number;
  pilot_crashes_today: number;
  target_app_version: string;
};

export type MigrationStatusRow = {
  id: string;
  status: "applied" | "missing" | "unknown";
};

export type CrashSummary = {
  crashes_today: number;
  by_version: Array<{ version: string; count: number }>;
  by_shop: Array<{ shop_id: string; shop_name: string; count: number }>;
  by_device: Array<{ device_key: string; count: number }>;
};

export type OperationalAlert = {
  kind: string;
  severity: "high" | "medium" | "low";
  shop_id: string | null;
  shop_name: string | null;
  message: string;
};

export type DeviceSearchHit = {
  device_id: string;
  shop_id: string;
  shop_name: string;
  shop_number: string | null;
  device_fingerprint: string;
  label: string | null;
  platform: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  pending_outbound: number | null;
  last_error: string | null;
  last_push_ok_at: string | null;
  last_pull_at: string | null;
  owner_email: string | null;
};

export const PILOT_QUEUE_THRESHOLD = 10;
export const PILOT_OFFLINE_HOURS = 24;

export async function fetchPilotDashboard(): Promise<PilotDashboardMetrics | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("internal_ops_pilot_dashboard");
  if (error || !data || typeof data !== "object") return null;
  const j = data as Record<string, unknown>;
  return {
    total_pilot_shops: Number(j.total_pilot_shops ?? 0),
    active_pilot_shops: Number(j.active_pilot_shops ?? 0),
    at_risk_pilot_shops: Number(j.at_risk_pilot_shops ?? 0),
    shops_sync_failure: Number(j.shops_sync_failure ?? 0),
    shops_queue_overload: Number(j.shops_queue_overload ?? 0),
    shops_offline_24h: Number(j.shops_offline_24h ?? 0),
    shops_outdated_version: Number(j.shops_outdated_version ?? 0),
    pilot_revenue_ugx_30d: Number(j.pilot_revenue_ugx_30d ?? 0),
    pilot_crashes_today: Number(j.pilot_crashes_today ?? 0),
    target_app_version: String(j.target_app_version ?? "1.0.5"),
  };
}

export async function fetchPilotShops(filters: {
  businessType?: string;
  planCode?: string;
  activeOnly?: boolean | null;
  syncFilter?: string;
}): Promise<PilotShopRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_pilot_shops", {
    p_business_type: filters.businessType ?? null,
    p_plan_code: filters.planCode ?? null,
    p_active_only: filters.activeOnly ?? null,
    p_sync_filter: filters.syncFilter ?? null,
    p_limit: 300,
  });
  if (error || !Array.isArray(data)) return [];
  return data as PilotShopRow[];
}

export async function adminSetShopPilotCohort(shopId: string, enabled: boolean): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("admin_set_shop_pilot_cohort", {
    p_shop_id: shopId,
    p_enabled: enabled,
  });
  if (error) return { ok: false, message: error.message };
  const j = data as { ok?: boolean; error?: string };
  return j.ok ? { ok: true } : { ok: false, message: j.error ?? "Failed" };
}

export async function fetchShopInternalNotes(shopId: string): Promise<SharedInternalNote[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_list_shop_notes", { p_shop_id: shopId, p_limit: 40 });
  if (error || !Array.isArray(data)) return [];
  return data as SharedInternalNote[];
}

export async function addShopInternalNote(shopId: string, body: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("internal_ops_add_shop_note", { p_shop_id: shopId, p_body: body });
  if (error) return { ok: false, message: error.message };
  return (data as { ok?: boolean })?.ok ? { ok: true } : { ok: false, message: "Failed" };
}

export async function fetchTicketInternalNotes(ticketId: string): Promise<SharedInternalNote[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_list_ticket_notes", {
    p_ticket_id: ticketId,
    p_limit: 40,
  });
  if (error || !Array.isArray(data)) return [];
  return data as SharedInternalNote[];
}

export async function addTicketInternalNote(ticketId: string, body: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("internal_ops_add_ticket_note", {
    p_ticket_id: ticketId,
    p_body: body,
  });
  if (error) return { ok: false, message: error.message };
  return (data as { ok?: boolean })?.ok ? { ok: true } : { ok: false, message: "Failed" };
}

export async function fetchMigrationStatus(): Promise<MigrationStatusRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_migration_status");
  if (error || !data || typeof data !== "object") return [];
  const migrations = (data as { migrations?: unknown }).migrations;
  if (!Array.isArray(migrations)) return [];
  return migrations as MigrationStatusRow[];
}

export async function fetchCrashSummary(): Promise<CrashSummary | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("internal_ops_crash_summary");
  if (error || !data || typeof data !== "object") return null;
  return data as CrashSummary;
}

export async function fetchOperationalAlerts(): Promise<OperationalAlert[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_operational_alerts");
  if (error || !data || typeof data !== "object") return [];
  const alerts = (data as { alerts?: unknown }).alerts;
  return Array.isArray(alerts) ? (alerts as OperationalAlert[]) : [];
}

export async function searchDevices(query: string): Promise<DeviceSearchHit[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_device_search", { p_query: query, p_limit: 25 });
  if (error || !Array.isArray(data)) return [];
  return data as DeviceSearchHit[];
}

export async function submitPilotSupportTicket(input: {
  shopId: string;
  subject: string;
  body: string;
  diagnostics: PilotDiagnosticsExport | Record<string, unknown>;
  screenshotMeta?: { fileName?: string | null } | null;
}): Promise<{ ok: boolean; ticketId?: string; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("shop_submit_pilot_support_ticket", {
    p_shop_id: input.shopId,
    p_subject: input.subject,
    p_body: input.body,
    p_diagnostics: input.diagnostics as Record<string, unknown>,
    p_screenshot_meta: input.screenshotMeta ?? null,
  });
  if (error) return { ok: false, message: error.message };
  const j = data as { ok?: boolean; ticket_id?: string; error?: string };
  return j.ok ? { ok: true, ticketId: j.ticket_id } : { ok: false, message: j.error ?? "Failed" };
}

export async function reportAppCrashToCloud(input: {
  shopId?: string | null;
  deviceFingerprint?: string | null;
  deviceId?: string | null;
  appVersion?: string | null;
  scope?: string | null;
  message?: string | null;
  extras?: Record<string, string | number | boolean>;
}): Promise<void> {
  if (!supabase) return;
  void supabase.rpc("app_report_crash_event", {
    p_shop_id: input.shopId ?? null,
    p_device_fingerprint: input.deviceFingerprint ?? null,
    p_device_id: input.deviceId ?? null,
    p_app_version: input.appVersion ?? null,
    p_scope: input.scope ?? null,
    p_message: input.message ?? null,
    p_extras: input.extras ?? {},
  });
}
