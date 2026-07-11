import { supabase } from "./supabase";

export type AppReleaseUpdateType = "flexible" | "immediate";

/** Client-safe release policy — never includes internal notes. */
export type AppReleaseClientPolicy = {
  releaseId: string;
  versionNumber: string;
  releaseName: string;
  googlePlayVersionCode: number;
  minimumSupportedVersion: string;
  minimumSupportedVersionCode: number;
  updateType: AppReleaseUpdateType;
  promptUsers: boolean;
  forceBelowMinimum: boolean;
  showWhatsNew: boolean;
  publicNotesHtml: string;
  policyGeneration: number;
  publishedAt: string | null;
};

export type AppReleaseClientEventType =
  | "prompt_shown"
  | "user_skipped"
  | "download_started"
  | "download_completed"
  | "restart_requested"
  | "immediate_started"
  | "immediate_completed"
  | "error";

function mapPolicy(row: Record<string, unknown>): AppReleaseClientPolicy {
  return {
    releaseId: String(row.release_id),
    versionNumber: String(row.version_number ?? ""),
    releaseName: String(row.release_name ?? ""),
    googlePlayVersionCode: Number(row.google_play_version_code ?? 0),
    minimumSupportedVersion: String(row.minimum_supported_version ?? ""),
    minimumSupportedVersionCode: Number(row.minimum_supported_version_code ?? 0),
    updateType: String(row.update_type ?? "flexible") as AppReleaseUpdateType,
    promptUsers: Boolean(row.prompt_users),
    forceBelowMinimum: Boolean(row.force_below_minimum),
    showWhatsNew: Boolean(row.show_whats_new),
    publicNotesHtml: String(row.public_notes_html ?? ""),
    policyGeneration: Number(row.policy_generation ?? 0),
    publishedAt: row.published_at ? String(row.published_at) : null,
  };
}

export async function fetchAppReleaseClientPolicy(): Promise<AppReleaseClientPolicy | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_app_release_client_policy");
  if (error || !data) return null;
  const obj = data as { ok?: boolean; policy?: Record<string, unknown> | null };
  if (!obj.ok || !obj.policy) return null;
  return mapPolicy(obj.policy);
}

export async function logAppReleaseClientEvent(
  eventType: AppReleaseClientEventType,
  opts?: {
    releaseId?: string | null;
    deviceId?: string | null;
    appVersion?: string | null;
    versionCode?: number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!supabase) return;
  await supabase.rpc("log_app_release_client_event", {
    p_event_type: eventType,
    p_release_id: opts?.releaseId ?? null,
    p_device_id: opts?.deviceId ?? null,
    p_app_version: opts?.appVersion ?? null,
    p_version_code: opts?.versionCode ?? null,
    p_metadata: opts?.metadata ?? {},
  });
}
