import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { getDeviceOnline } from "./deviceOnline";
import { getHardwareCapabilitySnapshot, type HardwareCapabilitySnapshot } from "../services/hardware/hardwareCapabilities";
import { readSyncHealthMeta } from "./syncMeta";
import { getStartupDiagnosticsSnapshot, readPersistedStartupDiagnostics } from "./startupDiagnostics";

export type AndroidDiagnosticsReport = {
  generatedAt: string;
  deviceName: string;
  androidVersion: string;
  appVersion: string;
  build: string;
  platform: string;
  offline: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  hardware: HardwareCapabilitySnapshot;
  startup: ReturnType<typeof getStartupDiagnosticsSnapshot> | null;
};

export async function buildAndroidDiagnosticsReport(): Promise<AndroidDiagnosticsReport> {
  const health = readSyncHealthMeta();
  let deviceName = "Unknown device";
  let androidVersion = "—";
  let appVersion = import.meta.env.VITE_APP_VERSION?.trim() || "—";
  let build = "—";

  if (Capacitor.isNativePlatform()) {
    try {
      const info = await App.getInfo();
      appVersion = info.version;
      build = info.build;
    } catch {
      /* plugin unavailable */
    }
  }

  if (typeof navigator !== "undefined") {
    deviceName = navigator.userAgent.slice(0, 120);
    const match = navigator.userAgent.match(/Android\s+([\d.]+)/i);
    if (match?.[1]) androidVersion = match[1];
  }

  const hardware = await getHardwareCapabilitySnapshot();

  return {
    generatedAt: new Date().toISOString(),
    deviceName,
    androidVersion,
    appVersion,
    build,
    platform: Capacitor.getPlatform(),
    offline: !getDeviceOnline(),
    lastSyncAt: health.lastSuccessAt ?? null,
    lastSyncError: health.lastIssueCode !== "none" ? health.lastIssueCode : null,
    hardware,
    startup: getStartupDiagnosticsSnapshot() ?? readPersistedStartupDiagnostics(),
  };
}

export function formatAndroidDiagnosticsReport(report: AndroidDiagnosticsReport): string {
  return JSON.stringify(report, null, 2);
}
