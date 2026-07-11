import { supabase } from "./supabase";

type RpcResult = { ok: boolean; error?: string };

function rpcResult(data: unknown, error: { message: string } | null): RpcResult {
  if (error) return { ok: false, error: error.message };
  const obj = (data ?? {}) as Record<string, unknown>;
  if (obj.ok === false) return { ok: false, error: String(obj.error ?? "failed") };
  return { ok: true };
}

export type AppReleaseStatus = "draft" | "published" | "archived";
export type AppReleaseUpdateType = "flexible" | "immediate";

export type AppReleaseSummary = {
  id: string;
  versionNumber: string;
  releaseName: string;
  releaseDate: string | null;
  status: AppReleaseStatus;
  googlePlayVersionCode: number;
  minimumSupportedVersion: string;
  minimumSupportedVersionCode: number;
  updateType: AppReleaseUpdateType;
  promptUsers: boolean;
  forceBelowMinimum: boolean;
  showWhatsNew: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  publishedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type AppReleaseDetail = AppReleaseSummary & {
  publicNotesHtml: string;
  internalNotesHtml: string;
};

export type AppReleaseEvent = {
  id: string;
  releaseId: string | null;
  eventType: string;
  deviceId: string | null;
  appVersion: string | null;
  versionCode: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AppReleaseDraft = {
  id: string | null;
  versionNumber: string;
  releaseName: string;
  releaseDate: string;
  googlePlayVersionCode: string;
  minimumSupportedVersion: string;
  minimumSupportedVersionCode: string;
  updateType: AppReleaseUpdateType;
  promptUsers: boolean;
  forceBelowMinimum: boolean;
  showWhatsNew: boolean;
  publicNotesHtml: string;
  internalNotesHtml: string;
};

function mapSummary(row: Record<string, unknown>): AppReleaseSummary {
  return {
    id: String(row.id),
    versionNumber: String(row.version_number ?? ""),
    releaseName: String(row.release_name ?? ""),
    releaseDate: row.release_date ? String(row.release_date) : null,
    status: String(row.status ?? "draft") as AppReleaseStatus,
    googlePlayVersionCode: Number(row.google_play_version_code ?? 0),
    minimumSupportedVersion: String(row.minimum_supported_version ?? ""),
    minimumSupportedVersionCode: Number(row.minimum_supported_version_code ?? 0),
    updateType: String(row.update_type ?? "flexible") as AppReleaseUpdateType,
    promptUsers: Boolean(row.prompt_users),
    forceBelowMinimum: Boolean(row.force_below_minimum),
    showWhatsNew: Boolean(row.show_whats_new),
    publishedAt: row.published_at ? String(row.published_at) : null,
    publishedBy: row.published_by ? String(row.published_by) : null,
    publishedByName: String(row.published_by_name ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function mapDetail(row: Record<string, unknown>): AppReleaseDetail {
  return {
    ...mapSummary(row),
    publicNotesHtml: String(row.public_notes_html ?? ""),
    internalNotesHtml: String(row.internal_notes_html ?? ""),
  };
}

function mapEvent(row: Record<string, unknown>): AppReleaseEvent {
  return {
    id: String(row.id),
    releaseId: row.release_id ? String(row.release_id) : null,
    eventType: String(row.event_type ?? ""),
    deviceId: row.device_id ? String(row.device_id) : null,
    appVersion: row.app_version ? String(row.app_version) : null,
    versionCode: row.version_code == null ? null : Number(row.version_code),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? ""),
  };
}

export const EMPTY_RELEASE_DRAFT: AppReleaseDraft = {
  id: null,
  versionNumber: "",
  releaseName: "",
  releaseDate: "",
  googlePlayVersionCode: "",
  minimumSupportedVersion: "",
  minimumSupportedVersionCode: "0",
  updateType: "flexible",
  promptUsers: false,
  forceBelowMinimum: false,
  showWhatsNew: true,
  publicNotesHtml: "",
  internalNotesHtml: "",
};

export function releaseToDraft(release: AppReleaseDetail): AppReleaseDraft {
  return {
    id: release.id,
    versionNumber: release.versionNumber,
    releaseName: release.releaseName,
    releaseDate: release.releaseDate ?? "",
    googlePlayVersionCode: String(release.googlePlayVersionCode),
    minimumSupportedVersion: release.minimumSupportedVersion,
    minimumSupportedVersionCode: String(release.minimumSupportedVersionCode),
    updateType: release.updateType,
    promptUsers: release.promptUsers,
    forceBelowMinimum: release.forceBelowMinimum,
    showWhatsNew: release.showWhatsNew,
    publicNotesHtml: release.publicNotesHtml,
    internalNotesHtml: release.internalNotesHtml,
  };
}

export async function fetchAppReleases(): Promise<AppReleaseSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_list_app_releases");
  if (error || !data) return [];
  const obj = data as { releases?: Record<string, unknown>[] };
  return (obj.releases ?? []).map(mapSummary);
}

export async function fetchAppRelease(id: string): Promise<AppReleaseDetail | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_get_app_release", { p_id: id });
  if (error || !data) return null;
  const obj = data as { release?: Record<string, unknown> | null };
  if (!obj.release) return null;
  return mapDetail(obj.release);
}

export async function saveAppRelease(draft: AppReleaseDraft): Promise<{ ok: boolean; release?: AppReleaseDetail; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const code = parseInt(draft.googlePlayVersionCode, 10);
  const minCode = parseInt(draft.minimumSupportedVersionCode, 10);
  const { data, error } = await supabase.rpc("admin_save_app_release", {
    p_id: draft.id,
    p_version_number: draft.versionNumber.trim(),
    p_release_name: draft.releaseName.trim(),
    p_release_date: draft.releaseDate.trim() || null,
    p_google_play_version_code: code,
    p_minimum_supported_version: draft.minimumSupportedVersion.trim(),
    p_minimum_supported_version_code: Number.isFinite(minCode) ? minCode : 0,
    p_update_type: draft.updateType,
    p_prompt_users: draft.promptUsers,
    p_force_below_minimum: draft.forceBelowMinimum,
    p_show_whats_new: draft.showWhatsNew,
    p_public_notes_html: draft.publicNotesHtml,
    p_internal_notes_html: draft.internalNotesHtml,
  });
  const result = rpcResult(data, error);
  if (!result.ok) return result;
  const obj = data as { release?: Record<string, unknown> };
  return { ok: true, release: obj.release ? mapDetail(obj.release) : undefined };
}

export async function publishAppRelease(id: string): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_publish_app_release", { p_id: id });
  return rpcResult(data, error);
}

export async function resendAppReleaseNotification(id: string): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_resend_release_notification", { p_id: id });
  return rpcResult(data, error);
}

export async function archiveAppRelease(id: string): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_archive_app_release", { p_id: id });
  return rpcResult(data, error);
}

export async function duplicateAppRelease(id: string): Promise<{ ok: boolean; release?: AppReleaseDetail; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_duplicate_app_release", { p_id: id });
  const result = rpcResult(data, error);
  if (!result.ok) return result;
  const obj = data as { release?: Record<string, unknown> };
  return { ok: true, release: obj.release ? mapDetail(obj.release) : undefined };
}

export async function deleteAppRelease(id: string): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_delete_app_release", { p_id: id });
  return rpcResult(data, error);
}

export async function fetchAppReleaseEvents(limit = 80): Promise<AppReleaseEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_list_app_release_events", { p_limit: limit });
  if (error || !data) return [];
  const obj = data as { events?: Record<string, unknown>[] };
  return (obj.events ?? []).map(mapEvent);
}

/** Preview sample rows for internal admin demo mode. */
export const PREVIEW_APP_RELEASES: AppReleaseSummary[] = [
  {
    id: "preview-release-1",
    versionNumber: "1.0.12",
    releaseName: "June stability",
    releaseDate: "2026-06-01",
    status: "published",
    googlePlayVersionCode: 17,
    minimumSupportedVersion: "1.0.10",
    minimumSupportedVersionCode: 15,
    updateType: "flexible",
    promptUsers: true,
    forceBelowMinimum: true,
    showWhatsNew: true,
    publishedAt: daysAgoIso(3),
    publishedBy: null,
    publishedByName: "Preview Admin",
    createdAt: daysAgoIso(5),
    updatedAt: daysAgoIso(3),
  },
  {
    id: "preview-release-2",
    versionNumber: "1.0.13",
    releaseName: "Checkout polish",
    releaseDate: null,
    status: "draft",
    googlePlayVersionCode: 18,
    minimumSupportedVersion: "1.0.10",
    minimumSupportedVersionCode: 15,
    updateType: "immediate",
    promptUsers: true,
    forceBelowMinimum: false,
    showWhatsNew: true,
    publishedAt: null,
    publishedBy: null,
    publishedByName: "",
    createdAt: daysAgoIso(1),
    updatedAt: daysAgoIso(1),
  },
];

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
