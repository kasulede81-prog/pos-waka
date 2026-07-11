import type { DeviceAuthorityContext } from "./deviceAuthority";

/** Seed an approved operational device for unit tests that exercise cloud authorization. */
export function approvedDeviceAuthorityFixture(
  partial?: Partial<DeviceAuthorityContext>,
): DeviceAuthorityContext {
  return {
    shopId: "shop-test",
    deviceFingerprint: "test-device-fp",
    deviceId: "dev-test",
    formFactor: "tablet",
    approvalStatus: "approved",
    isDeviceAuthorized: true,
    isApproved: true,
    isOperational: true,
    status: "active",
    lastSyncAt: null,
    lastLoginAt: null,
    lastSeenAt: null,
    currentStaffClientId: null,
    appVersion: null,
    label: null,
    platform: null,
    pendingUploads: 0,
    pendingDownloads: 0,
    cloudStatus: null,
    recoveryStatus: null,
    ...partial,
  };
}
