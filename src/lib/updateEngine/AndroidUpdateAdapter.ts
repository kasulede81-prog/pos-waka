import { Capacitor } from "@capacitor/core";
import type { AppReleaseClientPolicy } from "../appReleaseClient";
import { WakaAppUpdate } from "../nativeAppUpdate";
import { evaluateAndroidEligibility, type PlayCheckSnapshot } from "./UpdateEligibility";
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

    const policy = context.policy;
    if (!policy) {
      return { phase: "idle", playAvailableVersionCode: 0, error: null };
    }

    let playCheck: PlayCheckSnapshot = {
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
    } catch (err) {
      const message = (err as Error).message ?? "play_check_failed";
      await logEvent("update_failed", {
        policy,
        versions: context.versions,
        metadata: { step: "checkForUpdate", message },
      });
      return { phase: "update_failed", playAvailableVersionCode: 0, error: message };
    }

    return evaluateAndroidEligibility(context, playCheck);
  }

  async startFlexibleUpdate(policy: AppReleaseClientPolicy): Promise<void> {
    const installed = await readInstalledVersion();
    const versions = resolveVersions(installed, policy);
    await logEvent("update_download_started", { policy, versions });
    await WakaAppUpdate.startFlexibleUpdate();
  }

  async startImmediateUpdate(policy: AppReleaseClientPolicy): Promise<void> {
    const installed = await readInstalledVersion();
    const versions = resolveVersions(installed, policy);
    await logEvent("update_install_started", { policy, versions });
    await WakaAppUpdate.startImmediateUpdate();
  }

  async completeFlexibleUpdate(policy: AppReleaseClientPolicy): Promise<void> {
    const installed = await readInstalledVersion();
    const versions = resolveVersions(installed, policy);
    await logEvent("restart_required", { policy, versions });
    await WakaAppUpdate.completeFlexibleUpdate();
  }
}

export const androidUpdateAdapter = new AndroidUpdateAdapter();
