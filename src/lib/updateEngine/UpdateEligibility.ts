import { Preferences } from "@capacitor/preferences";
import type { AppReleaseClientPolicy } from "../appReleaseClient";
import {
  resolveAndroidUpdateDecision,
  type AndroidUpdateDecision,
  type PlayCheckSnapshot,
} from "./UpdateDecision";
import { readUpdateDismissed, updateDismissalKey } from "./UpdateDismissal";
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

export type { PlayCheckSnapshot } from "./UpdateDecision";

/** Storage must never decide whether an update is shown — fail open. */
async function safeReadWhatsNewSeen(versionCode: number): Promise<boolean> {
  try {
    return await readWhatsNewSeen(versionCode);
  } catch {
    return false;
  }
}

/**
 * ANDROID-UPDATE-P1: reads the persisted state the decision needs, then delegates to the
 * pure `resolveAndroidUpdateDecision`. A null policy no longer short-circuits to `idle`
 * and `prompt_users` no longer suppresses a real Play update.
 */
export async function resolveAndroidDecisionForContext(
  context: PlatformUpdateContext,
  playCheck: PlayCheckSnapshot,
): Promise<AndroidUpdateDecision> {
  const installedCode = context.versions.installedVersionCode;
  const dismissKey = updateDismissalKey({
    availableVersionCode: playCheck.availableVersionCode,
    releaseId: context.policy?.releaseId ?? null,
  });
  const [dismissed, whatsNewSeen] = await Promise.all([
    readUpdateDismissed(dismissKey),
    safeReadWhatsNewSeen(installedCode),
  ]);

  return resolveAndroidUpdateDecision({
    policy: context.policy,
    installedVersionCode: installedCode,
    play: playCheck,
    offline: context.offline,
    preserveDownloadingPhase: context.preserveDownloadingPhase,
    dismissed,
    ignoreDismissal: context.reason === "manual",
    whatsNewSeen,
  });
}

export async function evaluateAndroidEligibility(
  context: PlatformUpdateContext,
  playCheck: PlayCheckSnapshot,
): Promise<PlatformEvaluationResult> {
  const decision = await resolveAndroidDecisionForContext(context, playCheck);
  return {
    phase: decision.phase,
    playAvailableVersionCode: decision.availableVersionCode,
    error: decision.error,
    decision,
  };
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

/**
 * ANDROID-UPDATE-P1: telemetry keys off the release id when a policy exists, and off the
 * Play version code when it does not, so a Play-only update is still logged exactly once.
 */
export function shouldLogUpdateAvailable(
  phase: UpdatePhase,
  policy: AppReleaseClientPolicy | null,
  lastLoggedReleaseId: string | null,
  playAvailableVersionCode = 0,
): boolean {
  if (phase !== "flexible_prompt" && phase !== "force_block") return false;
  const key = policy ? policy.releaseId : playAvailableVersionCode > 0 ? `play-${playAvailableVersionCode}` : null;
  if (!key) return false;
  return key !== lastLoggedReleaseId;
}

export function updateAvailableLogKey(
  policy: AppReleaseClientPolicy | null,
  playAvailableVersionCode: number,
): string | null {
  if (policy) return policy.releaseId;
  return playAvailableVersionCode > 0 ? `play-${playAvailableVersionCode}` : null;
}

export function isVerifiedUpdate(
  versions: VersionResolution,
  policy: AppReleaseClientPolicy | null,
): boolean {
  if (!policy || !versions.publishedVersionCode) return false;
  return versions.installedVersionCode >= policy.googlePlayVersionCode;
}
