/**
 * RS-FREEZE-1 Remote Support master switch.
 * Server default is OFF. Missing/invalid payloads are treated as disabled.
 */

export type RemoteSupportPlatformSettings = {
  enabled: boolean;
};

export const DEFAULT_REMOTE_SUPPORT_PLATFORM_SETTINGS: RemoteSupportPlatformSettings = {
  enabled: false,
};

export function parseRemoteSupportPlatformSettings(raw: unknown): RemoteSupportPlatformSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_REMOTE_SUPPORT_PLATFORM_SETTINGS };
  const o = raw as Record<string, unknown>;
  return { enabled: o.enabled === true };
}

export function isRemoteSupportPlatformEnabled(raw: unknown): boolean {
  return parseRemoteSupportPlatformSettings(raw).enabled === true;
}
