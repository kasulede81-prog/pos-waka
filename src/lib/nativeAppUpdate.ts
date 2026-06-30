import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type AppUpdateCheckResult = {
  updateAvailable: boolean;
  availableVersionCode: number;
  installStatus: number;
  clientVersionStalenessDays: number;
  flexibleAllowed: boolean;
  immediateAllowed: boolean;
};

export interface WakaAppUpdatePlugin {
  checkForUpdate(): Promise<AppUpdateCheckResult>;
  startFlexibleUpdate(): Promise<{ started: boolean }>;
  startImmediateUpdate(): Promise<{ started: boolean }>;
  completeFlexibleUpdate(): Promise<{ completed: boolean }>;
  getInstallStatus(): Promise<{ installStatus: number; availableVersionCode: number }>;
  addListener(
    eventName: "flexibleUpdateDownloaded",
    listenerFunc: (data: { installStatus: number }) => void,
  ): Promise<PluginListenerHandle>;
}

export const WakaAppUpdate = registerPlugin<WakaAppUpdatePlugin>("WakaAppUpdate");

/** InstallStatus.DOWNLOADED from Play Core */
export const PLAY_INSTALL_STATUS_DOWNLOADED = 11;
