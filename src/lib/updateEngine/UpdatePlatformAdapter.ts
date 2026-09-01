import type { AppReleaseClientPolicy } from "../appReleaseClient";
import type { AndroidUpdateDecision } from "./UpdateDecision";
import type { VersionResolution } from "./UpdateVersionResolver";

export type UpdatePlatform = "android" | "web" | "windows" | "ios";

export type UpdateEvaluateReason =
  | "startup"
  | "foreground"
  | "manual"
  | "poll"
  | "realtime"
  | "reconnect"
  | "platform";

export type UpdatePhase =
  | "idle"
  | "no_update"
  | "force_block"
  | "flexible_prompt"
  | "flexible_downloading"
  | "flexible_ready"
  | "whats_new"
  | "pwa_update"
  | "offline"
  | "update_failed";

export type PlatformEvaluationResult = {
  phase: UpdatePhase;
  playAvailableVersionCode: number;
  error: string | null;
  /** ANDROID-UPDATE-P1 — full audit trail of the Android decision (severity, source, fallback). */
  decision?: AndroidUpdateDecision;
};

export type PlatformUpdateContext = {
  policy: AppReleaseClientPolicy | null;
  versions: VersionResolution;
  reason: UpdateEvaluateReason;
  offline: boolean;
  pwaUpdatePending: boolean;
  preserveDownloadingPhase: boolean;
};

/** ANDROID-UPDATE-P1 — outcome of a user-triggered update action (never swallowed). */
export type UpdateActionOutcome = {
  ok: boolean;
  /** The Play Store listing was opened because Play Core could not start. */
  fallbackOpened: boolean;
  fallbackVia: "market" | "web" | "none";
  error: string | null;
};

export type PlatformAdapterCallbacks = {
  onPlatformSignal: (reason: UpdateEvaluateReason) => void;
};

export interface UpdatePlatformAdapter {
  readonly platform: UpdatePlatform;
  evaluate(context: PlatformUpdateContext): Promise<PlatformEvaluationResult>;
  initialize?(callbacks: PlatformAdapterCallbacks): () => void;
  startFlexibleUpdate?(policy: AppReleaseClientPolicy | null): Promise<{ started: boolean } | void>;
  startImmediateUpdate?(policy: AppReleaseClientPolicy | null): Promise<{ started: boolean } | void>;
  completeFlexibleUpdate?(policy: AppReleaseClientPolicy | null): Promise<{ completed: boolean } | void>;
  reloadWebApp?(): void;
  markPwaUpdateSeen?(): void;
}
