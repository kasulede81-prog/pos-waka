import { describe, expect, it, beforeEach } from "vitest";
import {
  canPerformPrimaryActionSync,
  clearDeviceAuthorityCache,
  isDeviceApprovedCachedSync,
  isPrimaryDeviceCachedSync,
  seedDeviceAuthorityCacheForTests,
  type DeviceAuthorityContext,
} from "./deviceAuthority";

beforeEach(() => {
  clearDeviceAuthorityCache();
});

function seedCache(ctx: DeviceAuthorityContext): void {
  seedDeviceAuthorityCacheForTests(ctx);
}

describe("deviceAuthority cache", () => {
  it("defaults permissive when cache is cold", () => {
    expect(isPrimaryDeviceCachedSync()).toBe(true);
    expect(isDeviceApprovedCachedSync()).toBe(true);
    expect(canPerformPrimaryActionSync("staff_manage")).toBe(true);
  });

  it("secondary device cannot perform primary actions when cached", () => {
    seedCache({
      shopId: "shop-1",
      deviceFingerprint: "fp-secondary",
      deviceId: "dev-2",
      deviceAuthority: "secondary",
      formFactor: "tablet",
      approvalStatus: "approved",
      isPrimary: false,
      isApproved: true,
      isOperational: true,
      primaryDeviceFingerprint: "fp-primary",
      primaryDeviceId: "dev-1",
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
    });
    expect(isPrimaryDeviceCachedSync()).toBe(false);
    expect(canPerformPrimaryActionSync("staff_manage")).toBe(false);
  });

  it("pending approval blocks operational access", () => {
    seedCache({
      shopId: "shop-1",
      deviceFingerprint: "fp-new",
      deviceId: "dev-3",
      deviceAuthority: "secondary",
      formFactor: "tablet",
      approvalStatus: "pending",
      isPrimary: false,
      isApproved: false,
      isOperational: false,
      primaryDeviceFingerprint: "fp-primary",
      primaryDeviceId: "dev-1",
      status: "disconnected",
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
    });
    expect(isDeviceApprovedCachedSync()).toBe(false);
  });
});

describe("authorizeBackupRestore primary gate", () => {
  it("blocks user import on secondary when primary exists in cache", async () => {
    seedCache({
      shopId: "shop-1",
      deviceFingerprint: "fp-secondary",
      deviceId: "dev-2",
      deviceAuthority: "secondary",
      formFactor: "tablet",
      approvalStatus: "approved",
      isPrimary: false,
      isApproved: true,
      isOperational: true,
      primaryDeviceFingerprint: "fp-primary",
      primaryDeviceId: "dev-1",
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
    });
    const { authorizeBackupRestore } = await import("./backupRestoreAuthorization");
    const r = authorizeBackupRestore({
      actor: { userId: "u1", role: "owner", displayName: "Owner" },
      snapshot: {
        kind: "remote",
        row: { plan_code: "business", max_devices: 5 },
      } as import("./subscriptionEntitlements").SubscriptionSnapshot,
      authMode: "supabase",
      purpose: "user_import",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorKey).toBe("notPrimaryDevice");
  });
});
