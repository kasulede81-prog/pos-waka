import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Preferences } from "@capacitor/preferences";
import {
  fetchAppReleaseClientPolicy,
  logAppReleaseClientEvent,
  type AppReleaseClientPolicy,
} from "./appReleaseClient";
import {
  isBelowMinimumVersionCode,
  isPlayUpdateAvailable,
  parseVersionCode,
} from "./appReleaseVersion";
import { getOrCreateDeviceId } from "./deviceId";
import { PLAY_INSTALL_STATUS_DOWNLOADED, WakaAppUpdate } from "./nativeAppUpdate";

export type AppReleaseUpdatePhase =
  | "idle"
  | "force_block"
  | "flexible_prompt"
  | "flexible_downloading"
  | "flexible_ready"
  | "whats_new";

export type AppReleaseUpdateState = {
  phase: AppReleaseUpdatePhase;
  policy: AppReleaseClientPolicy | null;
  currentVersion: string;
  currentVersionCode: number;
  playAvailableVersionCode: number;
  error: string | null;
};

const WHATS_NEW_KEY_PREFIX = "waka-whats-new-seen-";

export async function readInstalledAppVersion(): Promise<{ version: string; versionCode: number }> {
  let version = import.meta.env.VITE_APP_VERSION?.trim() || "0";
  let versionCode = 0;
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await App.getInfo();
      version = info.version || version;
      versionCode = parseVersionCode(info.build);
    } catch {
      /* ignore */
    }
  }
  return { version, versionCode };
}

async function readWhatsNewSeen(versionCode: number): Promise<boolean> {
  const { value } = await Preferences.get({ key: `${WHATS_NEW_KEY_PREFIX}${versionCode}` });
  return value === "1";
}

export async function markWhatsNewSeen(versionCode: number): Promise<void> {
  await Preferences.set({ key: `${WHATS_NEW_KEY_PREFIX}${versionCode}`, value: "1" });
}

export async function evaluateAppReleaseUpdate(): Promise<AppReleaseUpdateState> {
  const base: AppReleaseUpdateState = {
    phase: "idle",
    policy: null,
    currentVersion: "0",
    currentVersionCode: 0,
    playAvailableVersionCode: 0,
    error: null,
  };

  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return base;
  }

  const installed = await readInstalledAppVersion();
  base.currentVersion = installed.version;
  base.currentVersionCode = installed.versionCode;

  const policy = await fetchAppReleaseClientPolicy();
  base.policy = policy;

  if (!policy) return base;

  let playCheck = {
    updateAvailable: false,
    availableVersionCode: 0,
    installStatus: 0,
  };

  try {
    const check = await WakaAppUpdate.checkForUpdate();
    playCheck = {
      updateAvailable: check.updateAvailable,
      availableVersionCode: check.availableVersionCode,
      installStatus: check.installStatus,
    };
    base.playAvailableVersionCode = check.availableVersionCode;
  } catch (err) {
    base.error = (err as Error).message ?? "play_check_failed";
    await logAppReleaseClientEvent("error", {
      releaseId: policy.releaseId,
      metadata: { step: "checkForUpdate", message: base.error },
    });
    return base;
  }

  if (
    isBelowMinimumVersionCode(installed.versionCode, policy.minimumSupportedVersionCode, policy.forceBelowMinimum)
  ) {
    base.phase = "force_block";
    return base;
  }

  if (playCheck.installStatus === PLAY_INSTALL_STATUS_DOWNLOADED) {
    base.phase = "flexible_ready";
    return base;
  }

  const updateOnPlay = isPlayUpdateAvailable(installed.versionCode, playCheck.availableVersionCode);
  if (!updateOnPlay) {
    if (policy.showWhatsNew) {
      const seen = await readWhatsNewSeen(installed.versionCode);
      if (!seen && installed.versionCode >= policy.googlePlayVersionCode) {
        base.phase = "whats_new";
      }
    }
    return base;
  }

  if (!policy.promptUsers) {
    return base;
  }

  if (policy.updateType === "immediate") {
    base.phase = "force_block";
    return base;
  }

  base.phase = "flexible_prompt";
  const deviceId = await getOrCreateDeviceId();
  await logAppReleaseClientEvent("prompt_shown", {
    releaseId: policy.releaseId,
    deviceId,
    appVersion: installed.version,
    versionCode: installed.versionCode,
  });
  return base;
}

export async function startFlexibleAppUpdate(policy: AppReleaseClientPolicy): Promise<void> {
  const installed = await readInstalledAppVersion();
  const deviceId = await getOrCreateDeviceId();
  await logAppReleaseClientEvent("download_started", {
    releaseId: policy.releaseId,
    deviceId,
    appVersion: installed.version,
    versionCode: installed.versionCode,
  });
  await WakaAppUpdate.startFlexibleUpdate();
}

export async function startImmediateAppUpdate(policy: AppReleaseClientPolicy): Promise<void> {
  const installed = await readInstalledAppVersion();
  const deviceId = await getOrCreateDeviceId();
  await logAppReleaseClientEvent("immediate_started", {
    releaseId: policy.releaseId,
    deviceId,
    appVersion: installed.version,
    versionCode: installed.versionCode,
  });
  await WakaAppUpdate.startImmediateUpdate();
}

export async function completeFlexibleAppUpdate(policy: AppReleaseClientPolicy): Promise<void> {
  const installed = await readInstalledAppVersion();
  const deviceId = await getOrCreateDeviceId();
  await logAppReleaseClientEvent("restart_requested", {
    releaseId: policy.releaseId,
    deviceId,
    appVersion: installed.version,
    versionCode: installed.versionCode,
  });
  await WakaAppUpdate.completeFlexibleUpdate();
}

export async function logUpdateSkipped(policy: AppReleaseClientPolicy): Promise<void> {
  const installed = await readInstalledAppVersion();
  const deviceId = await getOrCreateDeviceId();
  await logAppReleaseClientEvent("user_skipped", {
    releaseId: policy.releaseId,
    deviceId,
    appVersion: installed.version,
    versionCode: installed.versionCode,
  });
}

export async function logDownloadCompleted(policy: AppReleaseClientPolicy): Promise<void> {
  const installed = await readInstalledAppVersion();
  const deviceId = await getOrCreateDeviceId();
  await logAppReleaseClientEvent("download_completed", {
    releaseId: policy.releaseId,
    deviceId,
    appVersion: installed.version,
    versionCode: installed.versionCode,
  });
}
