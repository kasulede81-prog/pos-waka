import { describe, expect, it, beforeEach } from "vitest";
import {
  canPerformDeviceAuthorizedActionSync,
  clearDeviceAuthorityCache,
  isDeviceApprovedCachedSync,
  isDeviceAuthorizedForManagementSync,
  seedDeviceAuthorityCacheForTests,
  type DeviceAuthorityContext,
} from "./deviceAuthority";

beforeEach(() => {
  clearDeviceAuthorityCache();
});

function seedCache(ctx: DeviceAuthorityContext): void {
  seedDeviceAuthorityCacheForTests(ctx);
}

const approvedDevice: DeviceAuthorityContext = {
  shopId: "shop-1",
  deviceFingerprint: "fp-approved",
  deviceId: "dev-2",
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
};

describe("deviceAuthority cache", () => {
  it("blocks management when cache is cold", () => {
    expect(isDeviceAuthorizedForManagementSync()).toBe(false);
    expect(isDeviceApprovedCachedSync()).toBe(false);
    expect(canPerformDeviceAuthorizedActionSync("staff_manage")).toBe(false);
  });

  it("approved device can manage staff", () => {
    seedCache(approvedDevice);
    expect(isDeviceAuthorizedForManagementSync()).toBe(true);
    expect(canPerformDeviceAuthorizedActionSync("staff_manage")).toBe(true);
  });

  it("pending approval blocks operational access", () => {
    seedCache({
      ...approvedDevice,
      approvalStatus: "pending",
      isDeviceAuthorized: false,
      isApproved: false,
      isOperational: false,
      status: "disconnected",
    });
    expect(isDeviceApprovedCachedSync()).toBe(false);
    expect(isDeviceAuthorizedForManagementSync()).toBe(false);
  });
});

describe("authorizeBackupRestore device gate", () => {
  it("allows user import on any approved device", async () => {
    seedCache(approvedDevice);
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
    expect(r.ok).toBe(true);
  });

  it("blocks user import when device is pending approval", async () => {
    seedCache({
      ...approvedDevice,
      approvalStatus: "pending",
      isDeviceAuthorized: false,
      isApproved: false,
      isOperational: false,
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
    if (!r.ok) expect(r.errorKey).toBe("deviceNotAuthorized");
  });
});
