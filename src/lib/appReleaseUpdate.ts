/**
 * @deprecated Use EnterpriseUpdateEngine from ./updateEngine/EnterpriseUpdateEngine
 */
export {
  markWhatsNewSeen,
} from "./updateEngine/UpdateEligibility";
export { readInstalledVersion as readInstalledAppVersion } from "./updateEngine/UpdateVersionResolver";

export type { UpdatePhase as AppReleaseUpdatePhase } from "./updateEngine/UpdatePlatformAdapter";

export type AppReleaseUpdateState = {
  phase: import("./updateEngine/UpdatePlatformAdapter").UpdatePhase;
  policy: import("./appReleaseClient").AppReleaseClientPolicy | null;
  currentVersion: string;
  currentVersionCode: number;
  playAvailableVersionCode: number;
  error: string | null;
};

import { EnterpriseUpdateEngine } from "./updateEngine/EnterpriseUpdateEngine";

export async function evaluateAppReleaseUpdate(): Promise<AppReleaseUpdateState> {
  const state = await EnterpriseUpdateEngine.evaluate("manual");
  return {
    phase: state.phase,
    policy: state.policy,
    currentVersion: state.versions.installedVersion,
    currentVersionCode: state.versions.installedVersionCode,
    playAvailableVersionCode: state.playAvailableVersionCode,
    error: state.error,
  };
}

export async function startFlexibleAppUpdate(
  policy: import("./appReleaseClient").AppReleaseClientPolicy,
): Promise<void> {
  void policy;
  await EnterpriseUpdateEngine.startFlexibleUpdate();
}

export async function startImmediateAppUpdate(
  policy: import("./appReleaseClient").AppReleaseClientPolicy,
): Promise<void> {
  void policy;
  await EnterpriseUpdateEngine.startImmediateUpdate();
}

export async function completeFlexibleAppUpdate(
  policy: import("./appReleaseClient").AppReleaseClientPolicy,
): Promise<void> {
  void policy;
  await EnterpriseUpdateEngine.completeFlexibleUpdate();
}

export async function logUpdateSkipped(
  policy: import("./appReleaseClient").AppReleaseClientPolicy,
): Promise<void> {
  void policy;
  await EnterpriseUpdateEngine.skipUpdate();
}

export async function logDownloadCompleted(
  policy: import("./appReleaseClient").AppReleaseClientPolicy,
): Promise<void> {
  void policy;
  await EnterpriseUpdateEngine.logDownloadCompleted();
}
