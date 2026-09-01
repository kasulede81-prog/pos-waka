/**
 * ANDROID-UPDATE-P1 — single source of truth for "is there an update, and how loud".
 *
 * Design rule (the P1 correction):
 *   Google Play availability decides WHETHER an update exists.
 *   The Supabase release policy decides HOW it is presented (mandatory vs recommended,
 *   copy, what's-new) — it can never hide a real Play update.
 *
 * Before P1 a null policy (no published `app_releases` row) or `prompt_users = false`
 * (the column default) collapsed the whole Android path to `idle` / `no_update`, so a
 * genuinely newer Play build produced no user-visible message at all.
 */
import type { AppReleaseClientPolicy } from "../appReleaseClient";
import { isBelowMinimumVersionCode, isPlayUpdateAvailable } from "../appReleaseVersion";
import { PLAY_INSTALL_STATUS_DOWNLOADED } from "../nativeAppUpdate";
import type { UpdatePhase } from "./UpdatePlatformAdapter";

export type UpdateSeverity = "mandatory" | "recommended" | "none";
export type UpdateDecisionSource = "play" | "policy" | "none";

export type PlayCheckSnapshot = {
  updateAvailable: boolean;
  availableVersionCode: number;
  installStatus: number;
  /** Play Core: is a FLEXIBLE flow allowed for this update? */
  flexibleAllowed?: boolean;
  /** Play Core: is an IMMEDIATE flow allowed for this update? */
  immediateAllowed?: boolean;
  /** True when `checkForUpdate()` itself rejected (Play Core unavailable). */
  checkFailed?: boolean;
  checkError?: string | null;
};

export type AndroidDecisionInput = {
  policy: AppReleaseClientPolicy | null;
  installedVersionCode: number;
  play: PlayCheckSnapshot;
  offline: boolean;
  preserveDownloadingPhase: boolean;
  /** Persisted dismissal for this exact version code / release. */
  dismissed: boolean;
  /** Manual "Check for updates" re-surfaces a dismissed recommended update. */
  ignoreDismissal: boolean;
  whatsNewSeen: boolean;
};

export type AndroidUpdateDecision = {
  phase: UpdatePhase;
  severity: UpdateSeverity;
  source: UpdateDecisionSource;
  /** Play (or, if Play is unreachable, the published policy) says a newer build exists. */
  playUpdateAvailable: boolean;
  availableVersionCode: number;
  dismissible: boolean;
  dismissed: boolean;
  /** Play Core can actually run an in-app flow for this update. */
  playCoreUsable: boolean;
  /** Play Core cannot run — the Play Store listing is the only path. */
  fallbackOnly: boolean;
  reason: string;
  error: string | null;
};

function baseDecision(input: AndroidDecisionInput): AndroidUpdateDecision {
  return {
    phase: "idle",
    severity: "none",
    source: "none",
    playUpdateAvailable: false,
    availableVersionCode: Math.max(0, input.play.availableVersionCode || 0),
    dismissible: true,
    dismissed: false,
    playCoreUsable: input.play.checkFailed !== true,
    fallbackOnly: input.play.checkFailed === true,
    reason: "idle",
    error: input.play.checkError ?? null,
  };
}

/**
 * Play truth. `availableVersionCode > installedVersionCode` is authoritative.
 * A stale `updateAvailable` flag with a non-newer code is NOT an update (T2/T10).
 */
export function resolvePlayUpdateAvailable(
  installedVersionCode: number,
  play: Pick<PlayCheckSnapshot, "updateAvailable" | "availableVersionCode">,
): boolean {
  if (isPlayUpdateAvailable(installedVersionCode, play.availableVersionCode)) return true;
  // Play reported availability but gave no usable code — trust the flag, not silence.
  return Boolean(play.updateAvailable) && (play.availableVersionCode ?? 0) <= 0;
}

/** Policy-only signal, used when Play Core cannot be reached at all. */
export function resolvePolicyUpdateAvailable(
  installedVersionCode: number,
  policy: AppReleaseClientPolicy | null,
): boolean {
  if (!policy) return false;
  return policy.googlePlayVersionCode > 0 && policy.googlePlayVersionCode > installedVersionCode;
}

export function resolveAndroidUpdateDecision(input: AndroidDecisionInput): AndroidUpdateDecision {
  const decision = baseDecision(input);
  const { policy, play, installedVersionCode } = input;

  if (input.offline) {
    return { ...decision, phase: "offline", reason: "offline" };
  }

  if (input.preserveDownloadingPhase) {
    return { ...decision, phase: "flexible_downloading", severity: "recommended", source: "play", reason: "download_in_progress" };
  }

  if (play.installStatus === PLAY_INSTALL_STATUS_DOWNLOADED) {
    return {
      ...decision,
      phase: "flexible_ready",
      severity: "recommended",
      source: "play",
      playUpdateAvailable: true,
      dismissible: false,
      reason: "play_download_complete",
    };
  }

  // Policy-driven hard floor. Independent of Play availability and never dismissible.
  const belowMinimum = policy
    ? isBelowMinimumVersionCode(
        installedVersionCode,
        policy.minimumSupportedVersionCode,
        policy.forceBelowMinimum,
      )
    : false;

  const playAvailable = resolvePlayUpdateAvailable(installedVersionCode, play);
  const policyAvailable = resolvePolicyUpdateAvailable(installedVersionCode, policy);

  if (belowMinimum) {
    const immediateUsable = play.checkFailed !== true && play.immediateAllowed !== false;
    return {
      ...decision,
      phase: "force_block",
      severity: "mandatory",
      source: "policy",
      playUpdateAvailable: playAvailable || policyAvailable,
      dismissible: false,
      dismissed: false,
      playCoreUsable: immediateUsable,
      fallbackOnly: !immediateUsable,
      reason: "below_minimum_supported_version",
    };
  }

  // Play Core unreachable: do not go silent if the published policy still shows a newer build.
  if (play.checkFailed) {
    if (policyAvailable) {
      return {
        ...decision,
        phase: policy?.updateType === "immediate" ? "force_block" : "flexible_prompt",
        severity: policy?.updateType === "immediate" ? "mandatory" : "recommended",
        source: "policy",
        playUpdateAvailable: true,
        dismissible: policy?.updateType !== "immediate",
        playCoreUsable: false,
        fallbackOnly: true,
        reason: "play_check_failed_policy_indicates_update",
      };
    }
    return {
      ...decision,
      phase: "update_failed",
      severity: "none",
      source: "none",
      playCoreUsable: false,
      fallbackOnly: true,
      reason: "play_check_failed",
      error: play.checkError ?? "play_check_failed",
    };
  }

  if (playAvailable) {
    const mandatory = policy?.updateType === "immediate";
    const flowAllowed = mandatory ? play.immediateAllowed !== false : play.flexibleAllowed !== false;

    if (mandatory) {
      return {
        ...decision,
        phase: "force_block",
        severity: "mandatory",
        source: "play",
        playUpdateAvailable: true,
        dismissible: false,
        playCoreUsable: flowAllowed,
        fallbackOnly: !flowAllowed,
        reason: "play_update_available_policy_immediate",
      };
    }

    if (input.dismissed && !input.ignoreDismissal) {
      return {
        ...decision,
        // No overlay, but the availability stays visible to manual checks / telemetry.
        phase: "no_update",
        severity: "recommended",
        source: "play",
        playUpdateAvailable: true,
        dismissible: true,
        dismissed: true,
        playCoreUsable: flowAllowed,
        fallbackOnly: !flowAllowed,
        reason: "recommended_update_dismissed_by_user",
      };
    }

    return {
      ...decision,
      phase: "flexible_prompt",
      severity: "recommended",
      source: "play",
      playUpdateAvailable: true,
      dismissible: true,
      dismissed: false,
      playCoreUsable: flowAllowed,
      fallbackOnly: !flowAllowed,
      // `prompt_users` is deliberately NOT a gate here — see module header.
      reason: policy
        ? `play_update_available_policy_prompt_users_${String(policy.promptUsers)}`
        : "play_update_available_no_policy",
    };
  }

  // No Play update. Policy may still have a newer published build than this install
  // (e.g. staged rollout not yet reaching this device) — surface it honestly, never force.
  if (policyAvailable) {
    if (input.dismissed && !input.ignoreDismissal) {
      return {
        ...decision,
        phase: "no_update",
        severity: "recommended",
        source: "policy",
        playUpdateAvailable: true,
        dismissed: true,
        reason: "policy_update_dismissed_by_user",
      };
    }
    return {
      ...decision,
      phase: "flexible_prompt",
      severity: "recommended",
      source: "policy",
      playUpdateAvailable: true,
      dismissible: true,
      playCoreUsable: play.flexibleAllowed !== false,
      fallbackOnly: play.flexibleAllowed === false,
      reason: "policy_published_version_newer_than_installed",
    };
  }

  if (policy?.showWhatsNew && !input.whatsNewSeen && installedVersionCode >= policy.googlePlayVersionCode) {
    return { ...decision, phase: "whats_new", severity: "none", source: "policy", reason: "whats_new_unseen" };
  }

  return { ...decision, phase: "no_update", severity: "none", source: "none", reason: "up_to_date" };
}
