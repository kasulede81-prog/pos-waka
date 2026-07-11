import { Preferences } from "@capacitor/preferences";
import type { AppReleaseClientPolicy } from "../appReleaseClient";
import { isBelowMinimumVersionCode, isPlayUpdateAvailable } from "../appReleaseVersion";
import { PLAY_INSTALL_STATUS_DOWNLOADED } from "../nativeAppUpdate";
import type { PlatformEvaluationResult, PlatformUpdateContext, UpdatePhase } from "./UpdatePlatformAdapter";
import type { VersionResolution } from "./UpdateVersionResolver";

const WHATS_NEW_KEY_PREFIX = "waka-whats-new-seen-";
const POLICY_GENERATION_KEY = "waka-update-policy-generation";

export async function readWhatsNewSeen(versionCode: number): Promise<boolean> {
  const { value } = await Preferences.get({ key: `${WHATS_NEW_KEY_PREFIX}${versionCode}` });
  return value === "1";
}

export async function markWhatsNewSeen(versionCode: number): Promise<void> {
  await Preferences.set({ key: `${WHATS_NEW_KEY_PREFIX}${versionCode}`, value: "1" });
}

export async function readLastPolicyGeneration(): Promise<number> {
  const { value } = await Preferences.get({ key: POLICY_GENERATION_KEY });
  const n = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
}

export async function writeLastPolicyGeneration(generation: number): Promise<void> {
  await Preferences.set({ key: POLICY_GENERATION_KEY, value: String(generation) });
}

export type PlayCheckSnapshot = {
  updateAvailable: boolean;
  availableVersionCode: number;
  installStatus: number;
};

export async function evaluateAndroidEligibility(
  context: PlatformUpdateContext,
  playCheck: PlayCheckSnapshot,
): Promise<PlatformEvaluationResult> {
  const base: PlatformEvaluationResult = {
    phase: "idle",
    playAvailableVersionCode: playCheck.availableVersionCode,
    error: null,
  };

  if (context.offline) {
    return { ...base, phase: "offline" };
  }

  const policy = context.policy;
  if (!policy) return base;

  if (context.preserveDownloadingPhase) {
    return { ...base, phase: "flexible_downloading" };
  }

  const installedCode = context.versions.installedVersionCode;

  if (
    isBelowMinimumVersionCode(
      installedCode,
      policy.minimumSupportedVersionCode,
      policy.forceBelowMinimum,
    )
  ) {
    return { ...base, phase: "force_block" };
  }

  if (playCheck.installStatus === PLAY_INSTALL_STATUS_DOWNLOADED) {
    return { ...base, phase: "flexible_ready" };
  }

  const updateOnPlay = isPlayUpdateAvailable(installedCode, playCheck.availableVersionCode);
  if (!updateOnPlay) {
    if (policy.showWhatsNew) {
      const seen = await readWhatsNewSeen(installedCode);
      if (!seen && installedCode >= policy.googlePlayVersionCode) {
        return { ...base, phase: "whats_new" };
      }
    }
    return { ...base, phase: "no_update" };
  }

  if (!policy.promptUsers) {
    return { ...base, phase: "no_update" };
  }

  if (policy.updateType === "immediate") {
    return { ...base, phase: "force_block" };
  }

  return { ...base, phase: "flexible_prompt" };
}

export function evaluateWebEligibility(context: PlatformUpdateContext): PlatformEvaluationResult {
  if (context.pwaUpdatePending) {
    return { phase: "pwa_update", playAvailableVersionCode: 0, error: null };
  }
  if (context.offline) {
    return { phase: "offline", playAvailableVersionCode: 0, error: null };
  }
  return { phase: "no_update", playAvailableVersionCode: 0, error: null };
}

export function evaluatePlaceholderEligibility(context: PlatformUpdateContext): PlatformEvaluationResult {
  if (context.offline) {
    return { phase: "offline", playAvailableVersionCode: 0, error: null };
  }
  return { phase: "idle", playAvailableVersionCode: 0, error: null };
}

export function shouldLogUpdateAvailable(
  phase: UpdatePhase,
  policy: AppReleaseClientPolicy | null,
  lastLoggedReleaseId: string | null,
): boolean {
  if (!policy) return false;
  if (phase !== "flexible_prompt" && phase !== "force_block") return false;
  return policy.releaseId !== lastLoggedReleaseId;
}

export function isVerifiedUpdate(
  versions: VersionResolution,
  policy: AppReleaseClientPolicy | null,
): boolean {
  if (!policy || !versions.publishedVersionCode) return false;
  return versions.installedVersionCode >= policy.googlePlayVersionCode;
}
