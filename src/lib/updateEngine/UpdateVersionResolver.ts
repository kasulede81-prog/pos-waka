import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import type { AppReleaseClientPolicy } from "../appReleaseClient";
import { compareVersionStrings, isBelowMinimumVersionCode, parseVersionCode } from "../appReleaseVersion";

export type VersionResolution = {
  installedVersion: string;
  installedVersionCode: number;
  publishedVersion: string | null;
  publishedVersionCode: number | null;
  minimumSupportedVersion: string | null;
  minimumSupportedVersionCode: number | null;
  updateType: "flexible" | "immediate" | null;
  forceUpdate: boolean;
  pilotEligible: boolean;
  platform: "android" | "web" | "windows" | "ios";
};

export function detectUpdatePlatform(): VersionResolution["platform"] {
  if (!Capacitor.isNativePlatform()) {
    if (typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)) return "windows";
    return "web";
  }
  const platform = Capacitor.getPlatform();
  if (platform === "android") return "android";
  if (platform === "ios") return "ios";
  return "windows";
}

export async function readInstalledVersion(): Promise<{ version: string; versionCode: number }> {
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

export function resolveVersions(
  installed: { version: string; versionCode: number },
  policy: AppReleaseClientPolicy | null,
): VersionResolution {
  const platform = detectUpdatePlatform();
  const publishedVersion = policy?.versionNumber ?? null;
  const publishedVersionCode = policy?.googlePlayVersionCode ?? null;
  const minimumSupportedVersion = policy?.minimumSupportedVersion || null;
  const minimumSupportedVersionCode = policy?.minimumSupportedVersionCode ?? null;
  const updateType = policy?.updateType ?? null;
  const forceUpdate = policy
    ? isBelowMinimumVersionCode(
        installed.versionCode,
        policy.minimumSupportedVersionCode,
        policy.forceBelowMinimum,
      ) || policy.updateType === "immediate"
    : false;
  const pilotEligible = publishedVersion
    ? compareVersionStrings(installed.version, publishedVersion) >= 0
    : true;

  return {
    installedVersion: installed.version,
    installedVersionCode: installed.versionCode,
    publishedVersion,
    publishedVersionCode,
    minimumSupportedVersion,
    minimumSupportedVersionCode,
    updateType,
    forceUpdate,
    pilotEligible,
    platform,
  };
}
