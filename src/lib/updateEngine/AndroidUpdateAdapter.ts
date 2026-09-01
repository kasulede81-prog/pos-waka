import { Capacitor } from "@capacitor/core";
import type { AppReleaseClientPolicy } from "../appReleaseClient";
import { WakaAppUpdate } from "../nativeAppUpdate";
import { evaluateAndroidEligibility } from "./UpdateEligibility";
import type { PlayCheckSnapshot } from "./UpdateDecision";
import { logUpdateEvent as logEvent } from "./UpdateEvents";
import { readInstalledVersion, resolveVersions } from "./UpdateVersionResolver";
import type {
  PlatformAdapterCallbacks,
  PlatformEvaluationResult,
  PlatformUpdateContext,
  UpdatePlatformAdapter,
} from "./UpdatePlatformAdapter";

export class AndroidUpdateAdapter implements UpdatePlatformAdapter {
  readonly platform = "android" as const;

  initialize(callbacks: PlatformAdapterCallbacks): () => void {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
      return () => undefined;
    }
    let flexHandle: { remove: () => void } | undefined;
    void WakaAppUpdate.addListener("flexibleUpdateDownloaded", () => {
      callbacks.onPlatformSignal("platform");
    }).then((h) => {
      flexHandle = h;
    });
    return () => {
      flexHandle?.remove();
    };
  }

  async evaluate(context: PlatformUpdateContext): Promise<PlatformEvaluationResult> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
      return { phase: "idle", playAvailableVersionCode: 0, error: null };
    }

    /**
     * ANDROID-UPDATE-P1: the Play check now runs even when `context.policy` is null.
     * Previously a missing/unpublished `app_releases` policy returned `idle` here, so a
     * genuinely newer Play build was never detected at all.
     */
    let playCheck: PlayCheckSnapshot = {
      updateAvailable: false,
      availableVersionCode: 0,
      installStatus: 0,
      flexibleAllowed: undefined,
      immediateAllowed: undefined,
    };

    try {
      const check = await WakaAppUpdate.checkForUpdate();
      playCheck = {
        updateAvailable: check.updateAvailable,
        availableVersionCode: check.availableVersionCode,
        installStatus: check.installStatus,
        flexibleAllowed: check.flexibleAllowed,
        immediateAllowed: check.immediateAllowed,
      };
    } catch (err) {
      const message = (err as Error).message ?? "play_check_failed";
      // Not swallowed: telemetry keeps flowing and the decision layer decides whether the
      // published policy still proves an update exists (fallback) or this is a real failure.
      await logEvent("update_failed", {
        policy: context.policy,
        versions: context.versions,
        metadata: { step: "checkForUpdate", message },
      }).catch(() => undefined);
      playCheck = {
        ...playCheck,
        checkFailed: true,
        checkError: message,
      };
    }

    return evaluateAndroidEligibility(context, playCheck);
  }

  async startFlexibleUpdate(policy: AppReleaseClientPolicy | null): Promise<{ started: boolean }> {
    const installed = await readInstalledVersion();
    const versions = resolveVersions(installed, policy);
    await logEvent("update_download_started", { policy, versions }).catch(() => undefined);
    const result = await WakaAppUpdate.startFlexibleUpdate();
    return { started: result.started !== false };
  }

  async startImmediateUpdate(policy: AppReleaseClientPolicy | null): Promise<{ started: boolean }> {
    const installed = await readInstalledVersion();
    const versions = resolveVersions(installed, policy);
    await logEvent("update_install_started", { policy, versions }).catch(() => undefined);
    const result = await WakaAppUpdate.startImmediateUpdate();
    return { started: result.started !== false };
  }

  async completeFlexibleUpdate(policy: AppReleaseClientPolicy | null): Promise<{ completed: boolean }> {
    const installed = await readInstalledVersion();
    const versions = resolveVersions(installed, policy);
    await logEvent("restart_required", { policy, versions }).catch(() => undefined);
    const result = await WakaAppUpdate.completeFlexibleUpdate();
    return { completed: result.completed !== false };
  }
}

export const androidUpdateAdapter = new AndroidUpdateAdapter();
