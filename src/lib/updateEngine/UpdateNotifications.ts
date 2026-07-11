import type { UpdatePhase } from "./UpdatePlatformAdapter";

export type UpdateNotificationKind =
  | "flexible_update"
  | "immediate_update"
  | "whats_new"
  | "restart_required"
  | "pwa_update"
  | "no_update"
  | "update_failed"
  | "offline"
  | "downloading";

export type UpdateNotificationState = {
  kind: UpdateNotificationKind | null;
  phase: UpdatePhase;
  titleKey: string;
  bodyKey: string;
  actionKey: string | null;
  dismissKey: string | null;
};

const PHASE_NOTIFICATION: Partial<Record<UpdatePhase, Omit<UpdateNotificationState, "phase">>> = {
  force_block: {
    kind: "immediate_update",
    titleKey: "updateRequiredTitle",
    bodyKey: "updateRequiredBody",
    actionKey: "updateNow",
    dismissKey: null,
  },
  flexible_prompt: {
    kind: "flexible_update",
    titleKey: "updateAvailableTitle",
    bodyKey: "updateAvailableBody",
    actionKey: "updateNow",
    dismissKey: "updateLater",
  },
  flexible_downloading: {
    kind: "downloading",
    titleKey: "updateDownloadingTitle",
    bodyKey: "updateDownloadingBody",
    actionKey: null,
    dismissKey: null,
  },
  flexible_ready: {
    kind: "restart_required",
    titleKey: "updateReadyTitle",
    bodyKey: "updateReadyBody",
    actionKey: "updateRestart",
    dismissKey: null,
  },
  whats_new: {
    kind: "whats_new",
    titleKey: "updateWhatsNewTitle",
    bodyKey: "updateWhatsNewBody",
    actionKey: "updateContinue",
    dismissKey: null,
  },
  pwa_update: {
    kind: "pwa_update",
    titleKey: "pwaUpdateTitle",
    bodyKey: "pwaUpdateBody",
    actionKey: "pwaUpdateCta",
    dismissKey: null,
  },
  no_update: {
    kind: "no_update",
    titleKey: "updateUpToDateTitle",
    bodyKey: "updateUpToDateBody",
    actionKey: null,
    dismissKey: null,
  },
  update_failed: {
    kind: "update_failed",
    titleKey: "updateFailedTitle",
    bodyKey: "updateFailedBody",
    actionKey: "updateRetry",
    dismissKey: "updateLater",
  },
  offline: {
    kind: "offline",
    titleKey: "updateOfflineTitle",
    bodyKey: "updateOfflineBody",
    actionKey: null,
    dismissKey: null,
  },
};

export function resolveUpdateNotification(phase: UpdatePhase): UpdateNotificationState {
  const mapped = PHASE_NOTIFICATION[phase];
  if (!mapped) {
    return {
      kind: null,
      phase,
      titleKey: "",
      bodyKey: "",
      actionKey: null,
      dismissKey: null,
    };
  }
  return { ...mapped, phase };
}

export function shouldShowOverlay(phase: UpdatePhase): boolean {
  return (
    phase === "force_block" ||
    phase === "flexible_prompt" ||
    phase === "flexible_downloading" ||
    phase === "flexible_ready" ||
    phase === "whats_new" ||
    phase === "pwa_update"
  );
}

export function shouldShowManualCheckToast(phase: UpdatePhase): boolean {
  return phase === "no_update" || phase === "update_failed" || phase === "offline";
}
