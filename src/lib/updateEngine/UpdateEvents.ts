import { logAppReleaseClientEvent, type AppReleaseClientEventType } from "../appReleaseClient";
import { getOrCreateDeviceId } from "../deviceId";
import type { ResolvedUpdatePolicy } from "./UpdatePolicyResolver";
import type { VersionResolution } from "./UpdateVersionResolver";

export type StandardUpdateEvent =
  | "update_available"
  | "update_download_started"
  | "update_download_completed"
  | "update_install_started"
  | "update_install_completed"
  | "update_failed"
  | "update_cancelled"
  | "restart_required"
  | "update_verified";

const EVENT_MAP: Record<StandardUpdateEvent, AppReleaseClientEventType> = {
  update_available: "prompt_shown",
  update_download_started: "download_started",
  update_download_completed: "download_completed",
  update_install_started: "immediate_started",
  update_install_completed: "immediate_completed",
  update_failed: "error",
  update_cancelled: "user_skipped",
  restart_required: "restart_requested",
  update_verified: "download_completed",
};

export type UpdateEventContext = {
  policy?: ResolvedUpdatePolicy | null;
  versions?: VersionResolution;
  metadata?: Record<string, unknown>;
};

export async function logUpdateEvent(
  event: StandardUpdateEvent,
  context: UpdateEventContext = {},
): Promise<void> {
  const policy = context.policy;
  const versions = context.versions;
  const deviceId = await getOrCreateDeviceId();
  await logAppReleaseClientEvent(EVENT_MAP[event], {
    releaseId: policy?.releaseId ?? null,
    deviceId,
    appVersion: versions?.installedVersion ?? null,
    versionCode: versions?.installedVersionCode ?? null,
    metadata: {
      standard_event: event,
      ...context.metadata,
    },
  });
}

export { EVENT_MAP as standardUpdateEventMap };
