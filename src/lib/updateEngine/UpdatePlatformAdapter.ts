import type { AppReleaseClientPolicy } from "../appReleaseClient";
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
};

export type PlatformUpdateContext = {
  policy: AppReleaseClientPolicy | null;
  versions: VersionResolution;
  reason: UpdateEvaluateReason;
  offline: boolean;
  pwaUpdatePending: boolean;
  preserveDownloadingPhase: boolean;
};

export type PlatformAdapterCallbacks = {
  onPlatformSignal: (reason: UpdateEvaluateReason) => void;
};

export interface UpdatePlatformAdapter {
  readonly platform: UpdatePlatform;
  evaluate(context: PlatformUpdateContext): Promise<PlatformEvaluationResult>;
  initialize?(callbacks: PlatformAdapterCallbacks): () => void;
  startFlexibleUpdate?(policy: AppReleaseClientPolicy): Promise<void>;
  startImmediateUpdate?(policy: AppReleaseClientPolicy): Promise<void>;
  completeFlexibleUpdate?(policy: AppReleaseClientPolicy): Promise<void>;
  reloadWebApp?(): void;
  markPwaUpdateSeen?(): void;
}
